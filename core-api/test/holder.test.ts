import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signConversationToken } from "../src/token.ts";
import { createTestApp, delivery, fakePhone, NOW, post, type TestApp } from "./app-helpers.ts";
import { appointmentsOf, at, createSetup, day, freeTimes, startLead, toolCall, type Lead, type Setup } from "./agenda-helpers.ts";
import { ownerClient } from "./helpers.ts";

const DAY = 86_400;
const secondsAgo = (days: number) => Math.floor(NOW.getTime() / 1000) - days * DAY;

describe("holders and test leads", () => {
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

  const call = (l: Lead, path: string, payload?: unknown, method: "GET" | "POST" = "POST") => toolCall(test, l.token, method, path, payload);
  const scalar = async (sql: string, values: unknown[] = []) => (await owner.query(sql, values)).rows[0]?.n as number;
  const send = async (s: Setup, from: string, daysAgo: number, body = "Hola") => {
    await post(test, delivery({ session: s.session, from, timestampSeconds: secondsAgo(daysAgo), body }));
    await test.app.idle();
  };
  const lastBot = () => JSON.parse(test.botCalls.at(-1)!.body);

  /** A customer who wrote 100 days ago and writes again now: the number may have a new owner. */
  const afterSilence = async (s: Setup, silenceDays = 100) => {
    const phone = fakePhone();
    const from = `${phone.digits}@c.us`;
    const first = await startLead(test, owner, s, { from, timestampSeconds: secondsAgo(silenceDays) });
    await send(s, from, 0, "Hola otra vez");
    return { ...first, from, phone };
  };

  describe("a number that changes owner", () => {
    it("asks nothing when there was no long silence, and the tool refuses to run", async () => {
      const s = await createSetup(owner);
      const l = await startLead(test, owner, s);
      await send(s, `${l.phone.digits}@c.us`, 0, "otra vez");
      expect(lastBot().contacto.reverificar).toBe(false);
      const response = await call(l, "confirmar_titular", { es_la_misma_persona: false });
      expect(response.statusCode).toBe(409);
      expect(response.json().error).toBe("invalid_state");
      expect(await scalar("select count(*)::int as n from core.identity_holders h join core.contact_identities i on i.id = h.identity_id where i.value = $1", [l.phone.e164])).toBe(1);
    });

    it("keeps everything when it is the same person, and stops asking", async () => {
      const s = await createSetup(owner);
      const l = await afterSilence(s);
      expect(lastBot().contacto.reverificar).toBe(true);
      const contacts = await scalar("select count(*)::int as n from public.contacts");

      const response = await call(l, "confirmar_titular", { es_la_misma_persona: true });
      expect(response.json()).toEqual({ misma_persona: true });

      expect(await scalar("select count(*)::int as n from public.contacts")).toBe(contacts);
      expect(await scalar("select count(*)::int as n from core.conversations where identity_id = (select id from core.contact_identities where value = $1)", [l.phone.e164])).toBe(1);
      expect((await call(l, "confirmar_titular", { es_la_misma_persona: true })).statusCode).toBe(409);
      expect((await call(l, "confirmar_titular", { es_la_misma_persona: false })).statusCode).toBe(409);
    });

    describe("when it is another person", () => {
      const setupOldOwner = async () => {
        const s = await createSetup(owner);
        const phone = fakePhone();
        const from = `${phone.digits}@c.us`;
        const old = await startLead(test, owner, s, { from, timestampSeconds: secondsAgo(100), pushName: "Marta", body: "Quiero cotizar" });
        await call(old, "guardar_datos", { nombre: "Marta", apellido: "Gómez", email: "marta@example.test", direccion: "Calle 1", tipo_cliente: "hogar" });
        await call(old, "cotizar", { tipo_cliente: "hogar", dormitorios: 3 });
        await test.db.query("select api.enqueue_outbound($1, 'Te envío la cotización')", [old.conversationId]);
        await send(s, from, 0, "Hola, ¿quién eres? Este número ahora es mío");
        return { s, old, from, phone };
      };

      it("closes the old holder, opens a new contact and a new conversation, and keeps the history of the first one", async () => {
        const { s, old, phone } = await setupOldOwner();
        const oldMessages = await scalar("select count(*)::int as n from core.messages where conversation_id = $1", [old.conversationId]);
        expect(oldMessages).toBe(3);

        const response = await call(old, "confirmar_titular", { es_la_misma_persona: false, nombre_nuevo: "Pedro" });
        expect(response.json()).toEqual({ misma_persona: false, nueva_conversacion: true });

        const holders = (await owner.query(
          `select h.contact_id::int as contact, h.valid_to is null as open, h.closed_reason from core.identity_holders h
           join core.contact_identities i on i.id = h.identity_id where i.value = $1 order by h.id`,
          [phone.e164],
        )).rows;
        expect(holders).toHaveLength(2);
        expect(holders[0]).toEqual({ contact: old.contactId, open: false, closed_reason: "reassigned_confirmed" });
        expect(holders[1].open).toBe(true);
        expect(holders[1].contact).not.toBe(old.contactId);

        const conversations = (await owner.query(
          `select id::int, closed_at is not null as closed, closed_reason, superseded_by::int, contact_id::int
           from core.conversations where identity_id = (select id from core.contact_identities where value = $1) order by id`,
          [phone.e164],
        )).rows;
        expect(conversations).toHaveLength(2);
        expect(conversations[0]).toMatchObject({ id: old.conversationId, closed: true, closed_reason: "holder_changed", superseded_by: conversations[1].id });
        expect(conversations[1]).toMatchObject({ closed: false, contact_id: holders[1].contact });

        // Nothing of the first owner was lost: the contact, its data, its quote and what was said before the silence.
        expect((await owner.query("select first_name, last_name, email_jsonb from public.contacts where id = $1", [old.contactId])).rows[0]).toMatchObject({ first_name: "Marta", last_name: "Gómez" });
        expect(await scalar("select count(*)::int as n from core.quotes where deal_id = $1", [old.dealId])).toBe(1);
        expect((await owner.query("select stage from public.deals where id = $1", [old.dealId])).rows[0].stage).toBe("proposal-sent");
        expect(await scalar("select count(*)::int as n from core.messages where conversation_id = $1", [old.conversationId])).toBe(2);
        expect(await scalar("select count(*)::int as n from core.messages where conversation_id = $1", [conversations[1].id])).toBe(1);

        const fresh = (await owner.query("select first_name, is_test, sales_id from public.contacts where id = $1", [holders[1].contact])).rows[0];
        expect(fresh.first_name).toBe("Pedro");
        expect(await scalar("select count(*)::int as n from public.deals where primary_contact_id = $1 and stage = 'opportunity'", [holders[1].contact])).toBe(1);
      });

      it("shows the new person nothing of the old one: not in the card, not in the history the bot receives", async () => {
        const { s, old, from } = await setupOldOwner();
        await call(old, "confirmar_titular", { es_la_misma_persona: false, nombre_nuevo: "Pedro" });

        const card = (await call(old, "ficha", undefined, "GET")).json();
        expect(card).toMatchObject({ nombre: "Pedro", apellido: null, email: null, direccion: null, cotizacion_vigente: null, cita: null, etapa: "opportunity" });
        expect(JSON.stringify(card)).not.toMatch(/Marta|Gómez|marta@/);

        await send(s, from, 0, "Necesito una cotización");
        const contract = lastBot();
        expect(contract.contacto).toMatchObject({ nombre: "Pedro", nuevo: false, reverificar: false });
        expect(contract.ficha).toMatchObject({ etapa: "opportunity", cotizacion_vigente: null });
        const history = JSON.stringify(contract.historial);
        expect(history).toContain("quién eres");
        expect(history).not.toMatch(/Quiero cotizar|cotización|Marta/);
      });

      it("lets the token of the old conversation act on the new one, and never on the old owner's data", async () => {
        const { old } = await setupOldOwner();
        await call(old, "confirmar_titular", { es_la_misma_persona: false });
        await call(old, "guardar_datos", { nombre: "Pedro", email: "pedro@example.test" });

        const { rows } = await owner.query("select first_name, email_jsonb from public.contacts where id = $1", [old.contactId]);
        expect(rows[0].first_name).toBe("Marta");
        expect(rows[0].email_jsonb).toEqual([{ email: "marta@example.test", type: "Work" }]);
        expect((await call(old, "ficha", undefined, "GET")).json()).toMatchObject({ nombre: "Pedro", email: "pedro@example.test" });

        // Tools keep working for the bot after the change: it can quote for the new person.
        expect((await call(old, "cotizar", { tipo_cliente: "hogar", dormitorios: 2 })).statusCode).toBe(200);
        expect(await scalar("select count(*)::int as n from core.quotes where deal_id = $1", [old.dealId])).toBe(1);
      });

      it("can happen again after another long silence, always with one open holder", async () => {
        const s = await createSetup(owner);
        const phone = fakePhone();
        const from = `${phone.digits}@c.us`;
        const first = await startLead(test, owner, s, { from, timestampSeconds: secondsAgo(300) });
        await send(s, from, 200);
        expect((await call(first, "confirmar_titular", { es_la_misma_persona: false })).statusCode).toBe(200);
        await send(s, from, 100);
        expect((await call(first, "confirmar_titular", { es_la_misma_persona: false })).statusCode).toBe(200);

        const holders = (await owner.query(
          "select h.valid_to is null as open from core.identity_holders h join core.contact_identities i on i.id = h.identity_id where i.value = $1 order by h.id",
          [phone.e164],
        )).rows;
        expect(holders.map((h) => h.open)).toEqual([false, false, true]);
      });

      it("does not touch the appointment of the previous owner", async () => {
        const s = await createSetup(owner);
        const phone = fakePhone();
        const from = `${phone.digits}@c.us`;
        const old = await startLead(test, owner, s, { from, timestampSeconds: secondsAgo(100) });
        await call(old, "guardar_datos", { nombre: "Marta", direccion: "Calle 1", tipo_cliente: "hogar" });
        await call(old, "cotizar", { tipo_cliente: "hogar", dormitorios: 3 });
        const slots = (await call(old, "horarios_libres", { desde: day(3), dias: 1 })).json().horarios as { inicio: string }[];
        await call(old, "reservar", { inicio: slots[0].inicio });
        await call(old, "confirmar", {});
        await send(s, from, 0, "Hola");

        await call(old, "confirmar_titular", { es_la_misma_persona: false });
        expect((await appointmentsOf(owner, old.dealId)).map((a) => a.status)).toEqual(["confirmed"]);
        // And the new person is not shown that appointment.
        expect((await call(old, "ficha", undefined, "GET")).json().cita).toBeNull();
      });

      it("only runs while the bot is active", async () => {
        const { old } = await setupOldOwner();
        await call(old, "escalar", { motivo: "ayuda" });
        expect((await call(old, "confirmar_titular", { es_la_misma_persona: false })).json()).toEqual({ error: "bot_paused" });
      });
    });

    it.each([
      ["no answer", {}],
      ["a name for the same person", { es_la_misma_persona: true, nombre_nuevo: "Pedro" }],
      ["a customer id", { es_la_misma_persona: false, contact_id: 1 }],
      ["an answer that is not a boolean", { es_la_misma_persona: "no" }],
      ["a name that is too long", { es_la_misma_persona: false, nombre_nuevo: "x".repeat(81) }],
    ])("rejects %s", async (_name, body) => {
      const s = await createSetup(owner);
      const l = await afterSilence(s);
      expect((await call(l, "confirmar_titular", body)).statusCode).toBe(400);
    });
  });

  describe('a lead whose name starts with "Prueba"', () => {
    const lead = async (isTest = false) => {
      const s = await createSetup(owner, { isTest });
      return { s, l: await startLead(test, owner, s) };
    };
    const flags = async (l: Lead) => ({
      contact: (await owner.query("select is_test from public.contacts where id = $1", [l.contactId])).rows[0].is_test as boolean,
      deals: (await owner.query("select is_test from public.deals where primary_contact_id = $1", [l.contactId])).rows.map((row) => row.is_test as boolean),
    });

    it.each([
      ["Prueba Sebas", {}],
      ["prueba sebas", {}],
      ["  PRUEBA Juanma", {}],
      ["Prueba", { apellido: "X" }],
      ["Pruebas Ltda", {}],
    ])("marks the contact and its opportunity when the name is %j", async (nombre, extra) => {
      const { l } = await lead();
      await call(l, "guardar_datos", { nombre, ...extra });
      expect(await flags(l)).toEqual({ contact: true, deals: [true] });
    });

    it("keeps the surname when the whole name comes in one field", async () => {
      const { l } = await lead();
      await call(l, "guardar_datos", { nombre: "Prueba Sebas" });
      expect((await owner.query("select first_name, last_name from public.contacts where id = $1", [l.contactId])).rows[0]).toEqual({ first_name: "Prueba", last_name: "Sebas" });
    });

    it.each([
      ["Pru", {}],
      ["Aprueba", {}],
      ["Juan", { apellido: "Prueba" }],
      ["Carlos Prueba", {}],
      ["Reprueba", {}],
    ])("does not mark a real customer called %j", async (nombre, extra) => {
      const { l } = await lead();
      await call(l, "guardar_datos", { nombre, ...extra });
      expect(await flags(l)).toEqual({ contact: false, deals: [false] });
    });

    it("never takes the mark back", async () => {
      const { l } = await lead();
      await call(l, "guardar_datos", { nombre: "Prueba Ana" });
      await call(l, "guardar_datos", { nombre: "Carlos", apellido: "Real" });
      expect((await flags(l)).contact).toBe(true);
    });

    it("marks it from the WhatsApp name, before the bot has asked anything", async () => {
      const s = await createSetup(owner);
      const l = await startLead(test, owner, s, { pushName: "Prueba Juanma" });
      expect(await flags(l)).toEqual({ contact: true, deals: [true] });
    });

    it("also marks a lead created or renamed from the panel", async () => {
      const created = await owner.query("insert into public.contacts (first_name, last_name) values ('Prueba', 'Panel') returning id::int, is_test");
      expect(created.rows[0].is_test).toBe(true);
      const { rows } = await owner.query("insert into public.contacts (first_name, last_name) values ('Ana', 'Real') returning id::int, is_test");
      expect(rows[0].is_test).toBe(false);
      await owner.query("update public.contacts set first_name = 'Prueba Ana' where id = $1", [rows[0].id]);
      expect((await owner.query("select is_test from public.contacts where id = $1", [rows[0].id])).rows[0].is_test).toBe(true);
    });

    it("makes every later opportunity of that contact a test too", async () => {
      const s = await createSetup(owner);
      const l = await startLead(test, owner, s, { pushName: "Prueba Sebas" });
      await owner.query("update public.deals set stage = 'lost' where id = $1", [l.dealId]);
      await send(s, `${l.phone.digits}@c.us`, 0, "Otra consulta");
      expect(await flags(l)).toEqual({ contact: true, deals: [true, true] });
    });

    it("keeps the documents of a test lead in their own numbering", async () => {
      const { l } = await lead();
      await call(l, "guardar_datos", { nombre: "Prueba Sebas", tipo_cliente: "hogar" });
      await call(l, "cotizar", { tipo_cliente: "hogar", dormitorios: 3 });
      // A test lead's quote is issued by the quote tool itself (CRM-T14c).
      const { rows } = await owner.query("select display_number, is_test from core.documents where deal_id = $1", [l.dealId]);
      expect(rows).toHaveLength(1);
      expect(rows[0].is_test).toBe(true);
      expect(rows[0].display_number).toMatch(/^PRUEBA-COT-/);
    });

    describe("its appointments do not block the real calendar", () => {
      const book = async (l: Lead, date: string, time: string) => {
        await freeTimes(test, l, date);
        return call(l, "reservar", { inicio: at(date, time) });
      };

      it("lets a real customer take the time a test lead holds, and still sees it free", async () => {
        const s = await createSetup(owner);
        const tester = await startLead(test, owner, s);
        const customer = await startLead(test, owner, s);
        await call(tester, "guardar_datos", { nombre: "Prueba Sebas" });
        const date = day(3);

        expect((await book(tester, date, "10:30")).statusCode).toBe(200);
        expect((await appointmentsOf(owner, tester.dealId))[0].is_test).toBe(true);
        expect(await freeTimes(test, customer, date)).toContain("10:30");
        expect((await book(customer, date, "10:30")).statusCode).toBe(200);
      });

      it("frees a time already held when the name turns out to be a test, even late", async () => {
        const s = await createSetup(owner);
        const late = await startLead(test, owner, s);
        const customer = await startLead(test, owner, s);
        const date = day(3);
        await freeTimes(test, customer, date); // the customer was shown 10:30 before the other lead booked it
        expect((await book(late, date, "10:30")).statusCode).toBe(200);
        expect(await freeTimes(test, customer, date)).not.toContain("10:30");
        expect((await call(customer, "reservar", { inicio: at(date, "10:30") })).statusCode).toBe(409);

        await call(late, "guardar_datos", { nombre: "Prueba Tardía" });

        expect((await appointmentsOf(owner, late.dealId))[0].is_test).toBe(true);
        expect(await freeTimes(test, customer, date)).toContain("10:30");
        expect((await book(customer, date, "10:30")).statusCode).toBe(200);
        expect(await scalar("select count(*)::int as n from core.appointments where technician_id = $1 and status = 'hold'", [s.technicianIds[0]])).toBe(2);
      });

      it("does not turn a real customer's appointment into a test", async () => {
        const s = await createSetup(owner);
        const real = await startLead(test, owner, s);
        await call(real, "guardar_datos", { nombre: "Carlos" });
        await book(real, day(3), "10:30");
        expect((await appointmentsOf(owner, real.dealId))[0].is_test).toBe(false);
      });
    });

    it("marks everything of a lead that comes from a test channel, whatever its name", async () => {
      const { l } = await lead(true);
      expect(await flags(l)).toEqual({ contact: true, deals: [true] });
    });
  });
});
