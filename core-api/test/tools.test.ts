import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signConversationToken } from "../src/token.ts";
import { createTestApp, delivery, fakePhone, NOW, post, type TestApp } from "./app-helpers.ts";
import { createTechnician, insertHold, ownerClient, setStatus } from "./helpers.ts";

type Conversation = { id: number; token: string; phone: { digits: string; e164: string }; dealId: number; contactId: number };

describe("bot tools", () => {
  let test: TestApp;
  let owner: pg.Client;

  beforeAll(async () => {
    test = createTestApp();
    owner = await ownerClient();
  });
  afterAll(async () => {
    await test.close();
    await owner.end();
  });

  const scalar = async (sql: string, values: unknown[] = []) => (await owner.query(sql, values)).rows[0]?.n as number;

  const tokenFor = (conversationId: number, brandId = 1, at: Date = NOW, secret = test.env.CONVERSATION_TOKEN_SECRET!) =>
    signConversationToken(secret, { brandId, conversationId }, at);

  const start = async (options: Parameters<typeof delivery>[0] = {}): Promise<Conversation> => {
    const phone = fakePhone();
    const body = delivery({ from: `${phone.digits}@c.us`, ...options });
    await post(test, body);
    await test.app.idle();
    const { rows } = await owner.query(
      `select cv.id::int as id, cv.contact_id::int as contact_id,
              (select d.id::int from public.deals d where d.primary_contact_id = cv.contact_id order by d.id desc limit 1) as deal_id
       from core.messages m join core.conversations cv on cv.id = m.conversation_id
       where m.provider_message_id = $1`,
      [(body.payload as { id: string }).id],
    );
    const row = rows[0];
    return { id: row.id, token: await tokenFor(row.id), phone, dealId: row.deal_id, contactId: row.contact_id };
  };

  const call = (token: string | null, method: "GET" | "POST", path: string, payload?: unknown) =>
    test.app.inject({
      method,
      url: `/tools/${path}`,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(payload === undefined ? {} : { "content-type": "application/json" }) },
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });

  const TOOLS = [
    ["GET", "ficha", undefined],
    ["POST", "guardar_datos", { nombre: "Ana" }],
    ["POST", "cotizar", { tipo_cliente: "hogar", dormitorios: 3 }],
    ["POST", "escalar", { motivo: "x" }],
    ["POST", "responder", { texto: "Hola" }],
  ] as const;

  describe("the token is the only way in", () => {
    it.each(TOOLS)("%s /tools/%s rejects a missing token", async (method, path, payload) => {
      expect((await call(null, method, path, payload)).statusCode).toBe(401);
    });

    it.each(TOOLS)("%s /tools/%s rejects a malformed Authorization header", async (method, path, payload) => {
      for (const authorization of ["Bearer", "Bearer ", "bearer abc", "Basic abc", "Bearer a.b.c", "abc"]) {
        const response = await test.app.inject({
          method,
          url: `/tools/${path}`,
          headers: { authorization, "content-type": "application/json" },
          payload: payload === undefined ? undefined : JSON.stringify(payload),
        });
        expect(response.statusCode, authorization).toBe(401);
      }
    });

    it("rejects an expired token (16 minutes old), a token signed with another secret, and a token for another brand", async () => {
      const conversation = await start();
      const expired = await tokenFor(conversation.id, 1, new Date(NOW.getTime() - 16 * 60_000));
      expect((await call(expired, "GET", "ficha")).statusCode).toBe(401);
      expect((await call(await tokenFor(conversation.id, 1, NOW, "x".repeat(40)), "GET", "ficha")).statusCode).toBe(401);

      await owner.query("insert into core.brands (id, slug, name, timezone) values (2, 'other', 'Other', 'UTC') on conflict do nothing");
      expect((await call(await tokenFor(conversation.id, 2), "GET", "ficha")).statusCode).toBe(401);
    });

    it("accepts a token just before it expires, and rejects it just after", async () => {
      const conversation = await start();
      const old = await tokenFor(conversation.id, 1, new Date(NOW.getTime() - 14 * 60_000));
      expect((await call(old, "GET", "ficha")).statusCode).toBe(200);
      const older = await tokenFor(conversation.id, 1, new Date(NOW.getTime() - 15 * 60_000 - 1000));
      expect((await call(older, "GET", "ficha")).statusCode).toBe(401);
    });

    it("rejects a token for a conversation that does not exist", async () => {
      expect((await call(await tokenFor(999_999_999), "GET", "ficha")).statusCode).toBe(401);
    });

    it("answers a conversation that was closed with no successor", async () => {
      const conversation = await start();
      await owner.query("update core.conversations set closed_at = now(), closed_reason = 'test' where id = $1", [conversation.id]);
      expect((await call(conversation.token, "GET", "ficha")).statusCode).toBe(409);
    });

    it("acts on the conversation that replaced the one in the token", async () => {
      const old = await start();
      const successor = await start();
      await owner.query("update core.conversations set closed_at = now(), closed_reason = 'holder_changed', superseded_by = $2 where id = $1", [
        old.id,
        successor.id,
      ]);
      await call(old.token, "POST", "guardar_datos", { nombre: "Nuevo" });
      expect((await owner.query("select first_name from public.contacts where id = $1", [successor.contactId])).rows[0].first_name).toBe("Nuevo");
      expect((await owner.query("select first_name from public.contacts where id = $1", [old.contactId])).rows[0].first_name).toBe("WhatsApp");
    });
  });

  describe("no tool takes an id", () => {
    it.each([
      ["guardar_datos", { nombre: "Ana" }],
      ["cotizar", { tipo_cliente: "hogar", dormitorios: 3 }],
      ["escalar", { motivo: "x" }],
      ["responder", { texto: "Hola" }],
    ])("rejects a customer id in the body of %s", async (path, valid) => {
      const { token } = await start();
      for (const field of ["contact_id", "contacto_id", "deal_id", "conversation_id", "conversacion_id", "id", "sales_id", "brand_id", "telefono"]) {
        const response = await call(token, "POST", path, { ...valid, [field]: 1 });
        expect(response.statusCode, `${path} + ${field}`).toBe(400);
      }
      expect((await call(token, "POST", path, valid)).statusCode).not.toBe(400);
    });

    it("rejects any query string or body on ficha", async () => {
      const { token } = await start();
      expect((await call(token, "GET", "ficha?contact_id=1")).statusCode).toBe(400);
      expect((await call(token, "GET", "ficha", { contact_id: 1 })).statusCode).toBe(400);
    });

    it("keeps each token to its own customer", async () => {
      const a = await start();
      const b = await start();
      await call(a.token, "POST", "guardar_datos", { nombre: "Ana", email: "ana@example.test" });
      const other = (await call(b.token, "GET", "ficha")).json();
      expect(other.nombre).toBeNull();
      expect(other.email).toBeNull();
    });

    it("rejects a body over 16 KB, and a body that is not JSON", async () => {
      const { token } = await start();
      expect((await call(token, "POST", "responder", { texto: "x".repeat(20_000) })).statusCode).toBe(413);
      const raw = await test.app.inject({ method: "POST", url: "/tools/escalar", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, payload: "nope" });
      expect(raw.statusCode).toBe(400);
    });
  });

  describe("ficha", () => {
    it("shows the customer's card with the phone masked, and nothing internal", async () => {
      const { token, phone } = await start({ pushName: "Carlos" });
      const response = await call(token, "GET", "ficha");
      const card = response.json();
      expect(card).toMatchObject({ nombre: "Carlos", apellido: null, email: null, etapa: "opportunity", cotizacion_vigente: null, cita: null });
      expect(card.telefono_enmascarado).toMatch(/^\+1•+\d{4}$/);
      expect(response.body).not.toContain(phone.digits);
      expect(response.body).not.toMatch(/contact_id|deal_id|conversation_id|"id"/);
    });

    it("has no name until the customer gives one", async () => {
      const { token } = await start();
      expect((await call(token, "GET", "ficha")).json().nombre).toBeNull();
    });
  });

  describe("guardar_datos", () => {
    it("saves what the customer said and shows it on the card", async () => {
      const { token, contactId, dealId } = await start();
      const saved = await call(token, "POST", "guardar_datos", {
        nombre: "Carlos",
        apellido: "Pérez",
        email: "CARLOS@Example.test",
        idioma: "es",
        tipo_cliente: "hogar",
        tipo_espacio: "home",
        zip: "32801",
        direccion: "123 Main St, Orlando",
        tamano: "3 dormitorios",
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json().guardado.sort()).toEqual(["direccion", "email", "idioma", "nombre", "tamano", "tipo_cliente", "tipo_espacio", "zip"]);

      const { rows } = await owner.query(
        `select c.first_name, c.last_name, c.email_jsonb, c.preferred_language,
                d.client_type, d.service_space_type, d.zip, d.service_address, d.service_space_size, d.stage
         from public.contacts c join public.deals d on d.id = $2 where c.id = $1`,
        [contactId, dealId],
      );
      expect(rows[0]).toMatchObject({
        first_name: "Carlos",
        last_name: "Pérez",
        email_jsonb: [{ email: "carlos@example.test", type: "Work" }],
        preferred_language: "es",
        client_type: "home",
        service_space_type: "home",
        zip: "32801",
        service_address: "123 Main St, Orlando",
        service_space_size: "3 dormitorios",
        stage: "contacted",
      });
      expect((await call(token, "GET", "ficha")).json()).toMatchObject({ nombre: "Carlos", apellido: "Pérez", email: "carlos@example.test", zip: "32801" });
    });

    it("splits a full name given in one field, and keeps a surname that was already given", async () => {
      const { token, contactId } = await start();
      await call(token, "POST", "guardar_datos", { nombre: "Carlos Pérez Gómez" });
      expect((await owner.query("select first_name, last_name from public.contacts where id = $1", [contactId])).rows[0]).toEqual({
        first_name: "Carlos",
        last_name: "Pérez Gómez",
      });
      await call(token, "POST", "guardar_datos", { nombre: "Carlos Andrés" });
      expect((await owner.query("select first_name, last_name from public.contacts where id = $1", [contactId])).rows[0]).toEqual({
        first_name: "Carlos Andrés",
        last_name: "Pérez Gómez",
      });
    });

    it("changes only what comes in, and does not add the same email twice", async () => {
      const { token, contactId } = await start();
      await call(token, "POST", "guardar_datos", { nombre: "Ana", email: "ana@example.test" });
      await call(token, "POST", "guardar_datos", { email: "ANA@example.test" });
      await call(token, "POST", "guardar_datos", { email: "otra@example.test" });
      const { rows } = await owner.query("select first_name, email_jsonb from public.contacts where id = $1", [contactId]);
      expect(rows[0].first_name).toBe("Ana");
      expect(rows[0].email_jsonb.map((e: { email: string }) => e.email)).toEqual(["ana@example.test", "otra@example.test"]);
    });

    it("keeps the opportunity in its stage until it knows the name and the type of customer", async () => {
      const { token, dealId } = await start();
      await call(token, "POST", "guardar_datos", { nombre: "Ana" });
      expect((await owner.query("select stage from public.deals where id = $1", [dealId])).rows[0].stage).toBe("opportunity");
      await call(token, "POST", "guardar_datos", { tipo_cliente: "empresa" });
      expect((await owner.query("select stage from public.deals where id = $1", [dealId])).rows[0].stage).toBe("contacted");
    });

    it.each([
      ["an empty body", {}],
      ["an invalid email", { email: "no-es-un-correo" }],
      ["an email with a space", { email: "a b@example.test" }],
      ["an unknown language", { idioma: "fr" }],
      ["an unknown customer type", { tipo_cliente: "otro" }],
      ["an unknown space type", { tipo_espacio: "casino" }],
      ["a name that is too long", { nombre: "x".repeat(81) }],
      ["an empty name", { nombre: "   " }],
      ["a zip with symbols", { zip: "32801;drop" }],
      ["an address that is too long", { direccion: "x".repeat(301) }],
      ["a control character", { nombre: "Ana\u0000" }],
      ["a number where text goes", { nombre: 5 }],
    ])("rejects %s", async (_name, body) => {
      const { token } = await start();
      const response = await call(token, "POST", "guardar_datos", body);
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("invalid_input");
    });

    it("does not store HTML or SQL as anything but text", async () => {
      const { token, contactId } = await start();
      await call(token, "POST", "guardar_datos", { nombre: "<script>alert(1)</script>", apellido: "'; drop table public.contacts; --" });
      const { rows } = await owner.query("select first_name, last_name from public.contacts where id = $1", [contactId]);
      expect(rows[0]).toEqual({ first_name: "<script>alert(1)</script>", last_name: "'; drop table public.contacts; --" });
      expect(await scalar("select count(*)::int as n from public.contacts")).toBeGreaterThan(0);
    });

    it("refuses opportunity fields when there is no open opportunity", async () => {
      const { token, dealId } = await start();
      await owner.query("update public.deals set stage = 'won' where id = $1", [dealId]);
      expect((await call(token, "POST", "guardar_datos", { zip: "32801" })).statusCode).toBe(409);
      expect((await call(token, "POST", "guardar_datos", { nombre: "Ana" })).statusCode).toBe(200);
    });
  });

  describe("cotizar: every amount is calculated by the database", () => {
    // Vectors from the sales prompt, with the example prices.
    it.each([
      {
        name: "prompt home example",
        body: {
          tipo_cliente: "hogar",
          dormitorios: 3,
          autos_techados: 2,
          areas_extra: [
            { techada: true, pies: 240 },
            { techada: false, pies: 2000 },
          ],
        },
        expected: { pies_cubiertos: 2100, pies_descubiertos: 2000, subtotal: 372, descuento: 26.04, total: 346, minimo_aplicado: false },
      },
      {
        name: "prompt business example",
        body: { tipo_cliente: "empresa", pies_cubiertos: 8000, areas_extra: [{ techada: false, pies: 3000 }] },
        expected: { pies_cubiertos: 8000, pies_descubiertos: 3000, subtotal: 1140, descuento: 79.8, total: 1060, minimo_aplicado: false },
      },
      {
        name: "home with two covered cars",
        body: { tipo_cliente: "hogar", dormitorios: 3, autos_techados: 2 },
        expected: { pies_cubiertos: 1860, pies_descubiertos: 0, subtotal: 223.2, total: 208, minimo_aplicado: false },
      },
      {
        name: "small business: the minimum applies",
        body: { tipo_cliente: "empresa", pies_cubiertos: 1000 },
        expected: { subtotal: 120, total: 150, minimo_aplicado: true },
      },
      {
        name: "an area measured in meters and in paces",
        body: { tipo_cliente: "empresa", pies_cubiertos: 0, areas_extra: [{ techada: true, metros: 100 }, { techada: false, pasos_largo: 10, pasos_ancho: 4 }] },
        expected: { pies_cubiertos: 1076, pies_descubiertos: 250, minimo_aplicado: true, total: 150 },
      },
    ])("calculates $name", async ({ body, expected }) => {
      const { token } = await start();
      const response = await call(token, "POST", "cotizar", body);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ ...expected, moneda: "USD", descuento_pct: 7 });
    });

    it("says the prices are not confirmed yet, and returns nothing else", async () => {
      const { token } = await start();
      const quote = (await call(token, "POST", "cotizar", { tipo_cliente: "hogar", dormitorios: 3 })).json();
      expect(quote.precios_confirmados).toBe(false);
      expect(Object.keys(quote).sort()).toEqual([
        "descuento",
        "descuento_pct",
        "minimo_aplicado",
        "moneda",
        "pies_cubiertos",
        "pies_descubiertos",
        "precios_confirmados",
        "subtotal",
        "total",
        "version",
      ]);
    });

    it.each(["total", "precio", "monto", "subtotal", "descuento", "tarifa", "price", "amount"])("does not accept an amount of its own: %s", async (field) => {
      const { token } = await start();
      const response = await call(token, "POST", "cotizar", { tipo_cliente: "hogar", dormitorios: 3, [field]: 1 });
      expect(response.statusCode).toBe(400);
    });

    it.each([
      ["a home with no bedrooms", { tipo_cliente: "hogar" }],
      ["a home with square feet", { tipo_cliente: "hogar", dormitorios: 3, pies_cubiertos: 1000 }],
      ["a business with no area", { tipo_cliente: "empresa" }],
      ["a business with bedrooms", { tipo_cliente: "empresa", pies_cubiertos: 100, dormitorios: 2 }],
      ["negative bedrooms", { tipo_cliente: "hogar", dormitorios: -1 }],
      ["fractional bedrooms", { tipo_cliente: "hogar", dormitorios: 2.5 }],
      ["negative square feet", { tipo_cliente: "empresa", pies_cubiertos: -5 }],
      ["an extra area that does not say if it has a roof", { tipo_cliente: "empresa", pies_cubiertos: 100, areas_extra: [{ pies: 100 }] }],
      ["an extra area with two sizes", { tipo_cliente: "empresa", pies_cubiertos: 100, areas_extra: [{ techada: true, pies: 100, metros: 10 }] }],
      ["an extra area with no size", { tipo_cliente: "empresa", pies_cubiertos: 100, areas_extra: [{ techada: true }] }],
      ["too many cars", { tipo_cliente: "hogar", dormitorios: 1, autos_techados: 21 }],
      ["a customer type in English", { tipo_cliente: "home", dormitorios: 3 }],
      ["text where a number goes", { tipo_cliente: "hogar", dormitorios: "3" }],
    ])("rejects %s", async (_name, body) => {
      const { token } = await start();
      expect((await call(token, "POST", "cotizar", body)).statusCode).toBe(400);
    });

    it("keeps the quote, moves the opportunity and replaces the previous quote", async () => {
      const { token, dealId } = await start();
      const first = (await call(token, "POST", "cotizar", { tipo_cliente: "hogar", dormitorios: 3, autos_techados: 2 })).json();
      const second = (await call(token, "POST", "cotizar", { tipo_cliente: "hogar", dormitorios: 4, autos_techados: 2 })).json();

      expect(first.version).toBe(1);
      expect(second.version).toBe(2);
      const { rows } = await owner.query("select version, status, total::float from core.quotes where deal_id = $1 order by version", [dealId]);
      expect(rows).toEqual([
        { version: 1, status: "superseded", total: 208 },
        { version: 2, status: "sent", total: second.total },
      ]);
      const deal = (await owner.query("select stage, amount::float, client_type from public.deals where id = $1", [dealId])).rows[0];
      expect(deal).toEqual({ stage: "proposal-sent", amount: second.total, client_type: "home" });
    });

    it("shows the current quote on the card", async () => {
      const { token } = await start();
      const quote = (await call(token, "POST", "cotizar", { tipo_cliente: "hogar", dormitorios: 3, autos_techados: 2 })).json();
      const card = (await call(token, "GET", "ficha")).json();
      expect(card.cotizacion_vigente).toMatchObject({ total: quote.total, subtotal: quote.subtotal, version: 1 });
      expect(card.etapa).toBe("proposal-sent");
    });

    it("does not move a deal that is further along back to proposal sent", async () => {
      const { token, dealId } = await start();
      await owner.query("update public.deals set stage = 'in-negociation' where id = $1", [dealId]);
      await call(token, "POST", "cotizar", { tipo_cliente: "hogar", dormitorios: 3 });
      expect((await owner.query("select stage from public.deals where id = $1", [dealId])).rows[0].stage).toBe("in-negociation");
    });

    it("answers 409 when there is no open opportunity", async () => {
      const { token, dealId } = await start();
      await owner.query("update public.deals set stage = 'lost' where id = $1", [dealId]);
      expect((await call(token, "POST", "cotizar", { tipo_cliente: "hogar", dormitorios: 3 })).statusCode).toBe(409);
    });

    it("uses the price list in force: a new version changes the next quote and not the old one", async () => {
      // A second brand keeps this test from changing the prices of every other test.
      await owner.query("insert into core.brands (id, slug, name, timezone) values (2, 'other', 'Other', 'UTC') on conflict do nothing");
      await owner.query(
        `insert into core.channels (brand_id, provider, identifier, bot_key, secret_ref, is_test)
         values (2, 'waha', 'brand-two', 'javier', 'WAHA_HMAC_BYTOGAM_PRUEBAS', true) on conflict do nothing`,
      );
      const list = (version: number, rate: number, validFrom: string) =>
        owner.query(
          `insert into core.price_lists (brand_id, version, valid_from, is_confirmed, currency, covered_rate, uncovered_rate, discount_pct,
              min_total, home_base_sqft, home_bedroom_sqft, parking_first_car_sqft, parking_extra_car_sqft, sqm_to_sqft, pace_to_ft)
           values (2, $1, $3, true, 'USD', $2, $2, 0, 150, 1000, 140, 240, 200, 10.76, 2.5) on conflict do nothing`,
          [version, rate, validFrom],
        );
      await list(1, 0.5, "2020-01-01T00:00:00Z");

      const phone = fakePhone();
      const body = delivery({ session: "brand-two", from: `${phone.digits}@c.us` });
      await post(test, body);
      await test.app.idle();
      const { rows } = await owner.query(
        "select conversation_id::int as id, brand_id::int as brand from core.messages where provider_message_id = $1",
        [(body.payload as { id: string }).id],
      );
      const token = await tokenFor(rows[0].id, rows[0].brand);

      const before = (await call(token, "POST", "cotizar", { tipo_cliente: "empresa", pies_cubiertos: 8000 })).json();
      expect(before.total).toBe(4000);

      // The database decides what is in force with its own clock, not the one of the tests.
      const cut = new Date(Date.now() - 60_000).toISOString();
      await owner.query("update core.price_lists set valid_to = $1 where brand_id = 2 and version = 1", [cut]);
      await list(2, 1, cut);
      const after = (await call(token, "POST", "cotizar", { tipo_cliente: "empresa", pies_cubiertos: 8000 })).json();
      expect(after.total).toBe(8000);

      const quotes = (await owner.query(
        `select q.version, q.status, q.total::float from core.quotes q
         join core.price_lists p on p.id = q.price_list_id where p.brand_id = 2 order by q.version`,
      )).rows;
      expect(quotes).toEqual([
        { version: 1, status: "superseded", total: 4000 },
        { version: 2, status: "sent", total: 8000 },
      ]);
    });
  });

  describe("escalar", () => {
    it("pauses the bot and leaves one task for a person", async () => {
      const { token, id, contactId } = await start();
      const response = await call(token, "POST", "escalar", { motivo: "El cliente pide hablar con una persona" });
      expect(response.json()).toEqual({ pausado: true, ya_estaba_pausado: false });

      const conversation = (await owner.query("select bot_paused, bot_paused_reason from core.conversations where id = $1", [id])).rows[0];
      expect(conversation).toEqual({ bot_paused: true, bot_paused_reason: "El cliente pide hablar con una persona" });
      const tasks = (await owner.query("select type, text, due_date from public.tasks where contact_id = $1", [contactId])).rows;
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ type: "follow-up", text: "Atender a mano: el bot pidió ayuda. Motivo: El cliente pide hablar con una persona" });
    });

    it("does not leave a second task when it is called again", async () => {
      const { token, contactId } = await start();
      await call(token, "POST", "escalar", { motivo: "uno" });
      const again = await call(token, "POST", "escalar", { motivo: "dos" });
      expect(again.statusCode).toBe(409); // the bot is paused now: nothing but reading its card
      expect(await scalar("select count(*)::int as n from public.tasks where contact_id = $1", [contactId])).toBe(1);
    });

    it("leaves one task even if the database function is called twice, whatever the route does", async () => {
      const { id, contactId } = await start();
      await test.db.query("select api.escalate($1, 'uno')", [id]);
      const again = await test.db.query("select api.escalate($1, 'dos') as result", [id]);
      expect(again.rows[0].result).toEqual({ pausado: true, ya_estaba_pausado: true });
      expect(await scalar("select count(*)::int as n from public.tasks where contact_id = $1", [contactId])).toBe(1);
    });

    it("stops every other tool, and the bot is not called for the next message", async () => {
      const conversation = await start();
      await call(conversation.token, "POST", "escalar", { motivo: "ayuda" });

      for (const [method, path, payload] of TOOLS.filter(([, path]) => path !== "ficha" && path !== "escalar")) {
        const response = await call(conversation.token, method, path, payload);
        expect(response.statusCode, path).toBe(409);
        expect(response.json()).toEqual({ error: "bot_paused" });
      }
      expect((await call(conversation.token, "GET", "ficha")).statusCode).toBe(200);

      const calls = test.botCalls.length;
      await post(test, delivery({ from: `${conversation.phone.digits}@c.us`, body: "¿Hay alguien?" }));
      await test.app.idle();
      expect(test.botCalls.length).toBe(calls);
    });

    it.each([["empty reason", { motivo: "" }], ["no reason", {}], ["a long reason", { motivo: "x".repeat(301) }]])("rejects %s", async (_name, body) => {
      const { token } = await start();
      expect((await call(token, "POST", "escalar", body)).statusCode).toBe(400);
    });
  });

  describe("responder: what the model says is checked against the database", () => {
    const queued = (conversationId: number) => scalar("select count(*)::int as n from core.outbox where conversation_id = $1", [conversationId]);

    it("queues an ordinary reply, keeps it in the history and sends it through the outbox", async () => {
      const { token, id } = await start();
      const response = await call(token, "POST", "responder", { texto: "Hola, soy Javier. ¿Con quién tengo el gusto?" });
      expect(response.json()).toMatchObject({ encolado: true });
      expect(await queued(id)).toBe(1);
      const { rows } = await owner.query("select body from core.outbox where conversation_id = $1", [id]);
      expect(rows[0].body).toBe("Hola, soy Javier. ¿Con quién tengo el gusto?");
      expect((await owner.query("select direction, sender from core.messages where conversation_id = $1 and direction = 'out'", [id])).rows).toEqual([
        { direction: "out", sender: "bot" },
      ]);
    });

    it("sends the real number only to the customer, and keeps the placeholder in the history", async () => {
      const { token, id, phone } = await start();
      const response = await call(token, "POST", "responder", { texto: "Tu celular es {{telefono}}, ¿es correcto?" });
      expect(response.statusCode).toBe(200);
      const outbox = (await owner.query("select body from core.outbox where conversation_id = $1", [id])).rows[0].body;
      const history = (await owner.query("select body from core.messages where conversation_id = $1 and direction = 'out'", [id])).rows[0].body;
      expect(outbox).toMatch(/^Tu celular es \(202\) 555-\d{4}, ¿es correcto\?$/);
      expect(outbox).toContain(phone.digits.slice(-4));
      expect(history).toBe("Tu celular es {{telefono}}, ¿es correcto?");

      // The next call to the bot carries the history: the number must not be in it.
      await post(test, delivery({ from: `${phone.digits}@c.us`, body: "Sí" }));
      await test.app.idle();
      expect(test.botCalls.at(-1)!.body).not.toContain(phone.digits);
      expect(test.botCalls.at(-1)!.body).toContain("{{telefono}}");
    });

    it("lets the bot repeat the quote it was given, and stops any other amount, which never reaches the customer", async () => {
      const { token, id } = await start();
      const quote = (await call(token, "POST", "cotizar", { tipo_cliente: "hogar", dormitorios: 3, autos_techados: 2 })).json();
      const before = await queued(id);

      const ok = await call(token, "POST", "responder", {
        texto: `*VALOR ESTIMADO: $${quote.total}*\n- Subtotal: *$${quote.subtotal}*\n- Descuento especial (7%): *-$${quote.descuento}*`,
      });
      expect(ok.statusCode).toBe(200);

      const wrong = await call(token, "POST", "responder", { texto: `*VALOR ESTIMADO: $${quote.total - 40}*` });
      expect(wrong.statusCode).toBe(422);
      expect(wrong.json()).toMatchObject({ error: "reply_rejected", reason: "amount_not_from_quote" });
      expect(wrong.json().message).toContain(String(quote.total));
      expect(await queued(id)).toBe(before + 1);
      expect((await owner.query("select reason from core.reply_reviews where conversation_id = $1", [id])).rows).toEqual([
        { reason: "amount_not_from_quote" },
      ]);
    });

    it("stops an amount before there is any quote", async () => {
      const { token, id } = await start();
      const response = await call(token, "POST", "responder", { texto: "Te cuesta unos $300" });
      expect(response.statusCode).toBe(422);
      expect(await queued(id)).toBe(0);
    });

    it("never lets the model say the service is scheduled when the database has no confirmed appointment", async () => {
      const { token, id } = await start();
      for (const texto of ["Tu servicio ya quedó agendado para el martes a las 11", "Your service is confirmed for Tuesday"]) {
        const response = await call(token, "POST", "responder", { texto });
        expect(response.statusCode).toBe(422);
        expect(response.json().reason).toBe("confirmation_without_appointment");
      }
      expect(await queued(id)).toBe(0);
    });

    it("does not accept a hold as a confirmation", async () => {
      const lead = await start();
      const technician = await createTechnician(owner);
      await insertHold(owner, { dealId: lead.dealId, contactId: lead.contactId }, technician, "2030-06-04T15:00:00Z", "2030-06-04T16:00:00Z");
      const response = await call(lead.token, "POST", "responder", { texto: "Tu servicio quedó agendado" });
      expect(response.json().reason).toBe("confirmation_without_appointment");
      expect((await call(lead.token, "POST", "responder", { texto: "Te reservo ese horario por 15 minutos" })).statusCode).toBe(200);
    });

    it("lets a confirmation through only with the date and time of the confirmed appointment", async () => {
      const lead = await start();
      const technician = await createTechnician(owner);
      const hold = await insertHold(owner, { dealId: lead.dealId, contactId: lead.contactId }, technician, "2030-06-04T15:00:00Z", "2030-06-04T16:00:00Z");
      await setStatus(owner, hold.id, "confirmed");

      const good = await call(lead.token, "POST", "responder", { texto: "Tu servicio ya quedó agendado para el martes 4 de junio a las 11:00 am." });
      expect(good.statusCode).toBe(200);

      const wrongTime = await call(lead.token, "POST", "responder", { texto: "Tu servicio ya quedó agendado para el martes a las 3 pm." });
      expect(wrongTime.json().reason).toBe("time_mismatch");
      const wrongDay = await call(lead.token, "POST", "responder", { texto: "Tu servicio quedó agendado para el sábado 8 de junio a las 11:00." });
      expect(wrongDay.json().reason).toBe("date_mismatch");
      expect(await queued(lead.id)).toBe(1);
    });

    it("stops links outside the brand's domains and numbers that look like a phone", async () => {
      const { token, id } = await start();
      expect((await call(token, "POST", "responder", { texto: "Paga en https://pagos-rapidos.example.com" })).json().reason).toBe("url_not_allowed");
      expect((await call(token, "POST", "responder", { texto: "Llámanos al (407) 555-1234" })).json().reason).toBe("phone_in_reply");
      expect((await call(token, "POST", "responder", { texto: "Mira https://salvionix.com/servicios" })).statusCode).toBe(200);
      expect(await queued(id)).toBe(1);
    });

    it("stops the phone placeholder for a customer with no number", async () => {
      const { token, id } = await start({ from: `${Date.now()}@lid` });
      const response = await call(token, "POST", "responder", { texto: "Tu celular es {{telefono}}" });
      expect(response.json().reason).toBe("phone_unavailable");
      expect(await queued(id)).toBe(0);
    });

    it.each([["no text", {}], ["empty text", { texto: " " }], ["too long", { texto: "x".repeat(4001) }]])("rejects %s", async (_name, body) => {
      const { token } = await start();
      expect((await call(token, "POST", "responder", body)).statusCode).toBe(400);
    });
  });
});
