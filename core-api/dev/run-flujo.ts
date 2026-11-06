// One step of the live flow of the presentation, against a core-api that is already up.
// Usage: npm run flujo -- <1|2|3|4>      (scripts\demo-flujo.ps1 runs them in order, pausing between steps)
//
// Everything goes through the real door: a signed webhook in the WAHA format into core-api, and the bot's
// tools (CRM-T6) with the token core-api gives it. The bot is a script (no n8n, no Claude); WAHA is a stand-in
// that keeps what core-api sends out. Nothing leaves this machine. The customer is fictitious.
import { randomInt } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { owner } from "../scripts/db-lib.ts";
import { safeEqualHex, signBotRequest } from "../src/signature.ts";
import { sendInbound, startWahaServer } from "./waha-sim.ts";

const step = Number(process.argv[2]);
if (![1, 2, 3, 4].includes(step)) {
  console.error("Usage: npm run flujo -- <1|2|3|4>");
  process.exit(2);
}

const need = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}: run "npm run local:init" in core-api`);
  return value;
};

// Detailed mode (FLUJO-PRESENTACION.cmd detalle): shows every call with its body and answer. Authentication headers,
// signatures, tokens and any value of the environment are never printed: they come out as ***.
const verbose = process.argv.includes("--detalle");
const ESC = String.fromCharCode(27);
const paint = (code: string) => `${ESC}[${code}m`;
const COLOR = { reset: paint("0"), send: paint("36"), answer: paint("32"), script: paint("35"), bad: paint("31") };
const SENSITIVE_KEY = /token|authorization|signature|secret|hmac|password|api[-_]?key|cookie/i;
const secretValues = Object.entries(process.env)
  .filter(([name, value]) => /SECRET|PASSWORD|KEY|HMAC|TOKEN|JWT/i.test(name) && (value ?? "").length >= 8)
  .map(([, value]) => value as string);
const scrub = (value: unknown): unknown => {
  if (typeof value === "string") return secretValues.reduce((text, secret) => text.split(secret).join("***"), value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, SENSITIVE_KEY.test(key) ? "***" : scrub(inner)]));
  }
  return value;
};
const indent = (text: string) => text.split("\n").map((line) => `        ${line}`).join("\n");
const json = (color: string, label: string, value: unknown) =>
  console.log(`${color}   ${label}\n${indent(JSON.stringify(scrub(value), null, 2) ?? "(vacío)")}${COLOR.reset}`);
/** One call, as the presentation shows it. `by` says who made it: the bot, or the script standing in for a person. */
const trace = (by: "bot" | "guion", method: string, path: string, sent: unknown, status: number, answered: unknown) => {
  if (!verbose) return;
  if (by === "guion") console.log(`${COLOR.script}   [guion] 🔧 Lo hace el guion, no el bot: ${method} ${path}${COLOR.reset}`);
  else console.log(`${COLOR.send}   🔧 Herramienta: ${method} ${path}${COLOR.reset}`);
  if (sent !== undefined) json(by === "guion" ? COLOR.script : COLOR.send, "➡ Enviado:", sent);
  json(status >= 400 ? COLOR.bad : COLOR.answer, `⬅ Respuesta ${status}:`, answered);
};

const coreApiUrl = `http://127.0.0.1:${process.env.PORT ?? 3000}`;
const session = "bytogam-pruebas";
const stateFile = resolve(import.meta.dirname, "../../.demo/flujo-presentacion.json");

type State = { phone: string };
const loadState = (): State | null => (existsSync(stateFile) ? (JSON.parse(readFileSync(stateFile, "utf8")) as State) : null);

// A fictional number in the 555-01xx range, away from the ones the presentation data uses (0111 to 0129).
const newPhone = (): string => `1407555${String(randomInt(130, 200)).padStart(4, "0")}`;

const SAY = {
  hello: "Hola, soy Javier, tu asesor de Salvionix. ¿Con quién tengo el gusto?",
  saved: "Mucho gusto, Rosa. Ya tengo anotados los datos de tu restaurante en Orlando. ¿Quieres que te calcule un valor estimado?",
  person: "Claro, te comunico con una persona del equipo. En breve te atienden.",
};

const CLIENT_TEXT: Record<number, string> = {
  1: "Hola, buenas tardes. Tengo un restaurante en Orlando y quiero información para desinfectarlo.",
  2: "Soy Rosa Delgado. El restaurante está en Orlando y tiene unos 2.400 pies cuadrados.",
  3: "Perfecto, ¿cuánto costaría?",
  4: "Prefiero hablar con una persona, por favor.",
};

const TITLE: Record<number, string> = {
  1: "Llega un cliente nuevo por WhatsApp",
  2: "Javier guarda la ficha del cliente",
  3: "Javier cotiza con la lista de precios de ejemplo",
  4: "El cliente pide hablar con una persona",
};

const money = (value: number): string => value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

type Contract = { token: string; mensaje: { id: string; texto: string } };

const botSecret = need("BOT_HMAC_SECRET");
const botUrl = new URL(need("BOT_URL_JAVIER"));
const wahaUrl = new URL(process.env.WAHA_BASE_URL ?? "http://127.0.0.1:3100");

const checks: { ok: boolean; label: string }[] = [];
const check = (ok: boolean, label: string) => {
  checks.push({ ok, label });
  console.log(`   ${ok ? "✅" : "❌"} ${label}`);
};

const tool = async (token: string, method: "GET" | "POST", name: string, body?: unknown) => {
  const response = await fetch(`${coreApiUrl}/tools/${name}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const answered = (await response.json().catch(() => ({}))) as Record<string, any>;
  trace("bot", method, `/tools/${name}`, body, response.status, answered);
  return { status: response.status, json: answered };
};

/** What the scripted bot does for each step, with only the tools and the token it was given. */
const botWork = async (contract: Contract): Promise<{ quote?: Record<string, any> }> => {
  const { token } = contract;
  const say = async (text: string) => {
    const result = await tool(token, "POST", "responder", { texto: text });
    if (result.status !== 200) throw new Error(`responder answered ${result.status}: ${result.json.reason ?? result.json.error ?? ""}`);
  };
  const ok = (result: { status: number; json: Record<string, any> }, name: string) => {
    if (result.status !== 200) throw new Error(`${name} answered ${result.status}: ${result.json.reason ?? result.json.error ?? ""}`);
    return result.json;
  };

  if (step === 1) {
    ok(await tool(token, "GET", "ficha"), "ficha");
    await say(SAY.hello);
  } else if (step === 2) {
    ok(
      await tool(token, "POST", "guardar_datos", {
        nombre: "Rosa",
        apellido: "Delgado",
        tipo_cliente: "empresa",
        tipo_espacio: "restaurant_kitchen",
        direccion: "Orlando, FL",
        tamano: "2.400 pies cuadrados",
      }),
      "guardar_datos",
    );
    await say(SAY.saved);
  } else if (step === 3) {
    const quote = ok(await tool(token, "POST", "cotizar", { tipo_cliente: "empresa", pies_cubiertos: 2400 }), "cotizar");
    const lines = quote.minimo_aplicado
      ? [`*VALOR ESTIMADO: $${money(quote.total)}*`, "- Valor mínimo por servicio."]
      : [
          `- Subtotal: *$${money(quote.subtotal)}*`,
          `- Descuento especial (${quote.descuento_pct}%): *-$${money(quote.descuento)}*`,
          `*VALOR ESTIMADO: $${money(quote.total)}*`,
        ];
    await say(["*COTIZACIÓN*", `- Área cubierta: *${money(quote.pies_cubiertos)}* pies cuadrados`, ...lines, "- Valor sujeto a revisión final en la visita."].join("\n"));
    return { quote };
  } else {
    await say(SAY.person);
    ok(await tool(token, "POST", "escalar", { motivo: 'El cliente pidió hablar con una persona: "Prefiero hablar con una persona, por favor."' }), "escalar");
  }
  return {};
};

let state = loadState();
if (step === 1) {
  state = { phone: newPhone() };
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state));
}
if (!state) {
  console.error("Primero corre el paso 1: ahí se crea el cliente.");
  process.exit(2);
}
const { phone } = state;

const health = await fetch(`${coreApiUrl}/healthz`).catch(() => null);
if (!health?.ok) {
  console.error(`core-api no responde en ${coreApiUrl}. Enciende la presentación con INICIAR-PRESENTACION.cmd.`);
  process.exit(2);
}

const waha = await startWahaServer({ port: Number(wahaUrl.port), apiKey: process.env.WAHA_API_KEY });
let work: Promise<{ quote?: Record<string, any> }> | undefined;
const handled = new Set<string>();
const bot = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    const timestamp = Number(request.headers["x-core-timestamp"]);
    const signature = String(request.headers["x-core-signature"] ?? "");
    const fresh = Number.isFinite(timestamp) && Math.abs(Date.now() / 1000 - timestamp) < 300;
    const valid = request.method === "POST" && request.url === botUrl.pathname && fresh && safeEqualHex(signature, signBotRequest(botSecret, timestamp, raw));
    if (!valid) {
      response.writeHead(401).end();
      return;
    }
    response.writeHead(200).end();
    const contract = JSON.parse(raw) as Contract;
    if (handled.has(contract.mensaje.id)) return;
    handled.add(contract.mensaje.id);
    work = botWork(contract);
    work.catch(() => undefined);
  });
});
await new Promise<void>((done, fail) => {
  bot.once("error", fail);
  bot.listen(Number(botUrl.port), botUrl.hostname, done);
});

const db = await owner(process.env.PGDATABASE ?? "salvionix");
const lookup = async () =>
  (
    await db.query(
      `select c.id as contact_id, c.first_name, c.last_name, d.id as deal_id, d.stage, d.amount, d.service_space_type, d.service_address, d.service_space_size
         from public.contacts c join public.deals d on d.primary_contact_id = c.id
        where c.phone_jsonb @> jsonb_build_array(jsonb_build_object('number', $1::text))
        order by d.id desc limit 1`,
      [`+${phone}`],
    )
  ).rows[0] as Record<string, any> | undefined;

try {
  console.log(`\n━━ Paso ${step} · ${TITLE[step]}`);
  console.log(`   👤 Cliente (+${phone}): ${CLIENT_TEXT[step]}`);
  const before = waha.to(phone).length;
  if (verbose) {
    console.log(`${COLOR.send}   📥 Entra por el webhook: POST /hooks/whatsapp   (firma HMAC: ***)${COLOR.reset}`);
    json(COLOR.send, "➡ Enviado por WhatsApp:", { event: "message", session, payload: { from: `${phone}@c.us`, body: CLIENT_TEXT[step] } });
  }
  const sent = await sendInbound({ coreApiUrl, session, hmacSecret: need("WAHA_HMAC_BYTOGAM_PRUEBAS") }, { phone, text: CLIENT_TEXT[step] });
  check(sent.status === 200, `core-api aceptó el mensaje firmado (${sent.status})`);
  if (sent.status !== 200) throw new Error("El mensaje no fue aceptado");

  const deadline = Date.now() + 25_000;
  while (!work) {
    if (Date.now() > deadline) throw new Error("core-api no llamó al bot a tiempo");
    await new Promise((done) => setTimeout(done, 50));
  }
  const result = await work;
  await waha.waitFor(phone, before + 1, 20_000);
  const reply = waha.to(phone)[before]?.text ?? "";
  console.log(`   🤖 Javier: ${reply.split("\n").map((line, index) => (index === 0 ? line : `        ${line}`)).join("\n")}`);

  const now = await lookup();
  check(Boolean(now), "El contacto y su negocio están en la base");
  if (now && step === 1) {
    check(now.stage === "opportunity", 'El negocio quedó en "Nueva consulta"');
    console.log(`   👀 Se refleja en el CRM: contacto «${now.first_name} ${now.last_name}» y un negocio nuevo en "Nueva consulta".`);
  }
  if (now && step === 2) {
    check(now.first_name === "Rosa" && now.last_name === "Delgado", "El nombre quedó guardado: Rosa Delgado");
    check(now.service_space_type === "restaurant_kitchen" && now.service_address === "Orlando, FL" && Boolean(now.service_space_size), "Ficha: restaurante, Orlando, FL, 2.400 pies cuadrados");
    // `guardar_datos` does not rename the opportunity. The script names it through the panel's own door, as a person would.
    const renamed = await fetch(`${coreApiUrl}/admin/rest/deals?id=eq.${now.deal_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify({ name: "Rosa Delgado – Restaurante, 2.400 pies" }),
    });
    trace("guion", "PATCH", `/admin/rest/deals?id=eq.${now.deal_id}`, { name: "Rosa Delgado – Restaurante, 2.400 pies" }, renamed.status, { resultado: "sin cuerpo (204)" });
    check(renamed.status === 204, "[guion] El negocio quedó con nombre: «Rosa Delgado – Restaurante, 2.400 pies»");
    console.log("   👀 Se refleja en el CRM: abre el negocio; la ficha ya tiene nombre, ciudad, tipo de lugar y tamaño.");
  }
  if (now && step === 3 && result.quote) {
    const total = Number(result.quote.total);
    check(Number(now.amount) === total, `El monto del negocio ($${money(Number(now.amount))}) es el que calculó la base ($${money(total)})`);
    check(now.stage === "proposal-sent", 'El negocio pasó a "Cotizado"');
    // Today `cotizar` does not leave a note. The script leaves it through the panel's own door, like a person would.
    const asked = await fetch(`${coreApiUrl}/admin/session`);
    const salesId = asked.ok ? ((await asked.json()) as { id: number }).id : undefined;
    const q = result.quote;
    const text = [
      "Cotización calculada por Javier (precios de ejemplo, por confirmar)",
      `Área cubierta: ${money(Number(q.pies_cubiertos))} pies cuadrados.`,
      q.minimo_aplicado ? `Valor mínimo por servicio: $${money(total)}.` : `Subtotal $${money(Number(q.subtotal))}, descuento ${q.descuento_pct}% (-$${money(Number(q.descuento))}), total $${money(total)}.`,
    ].join("\n");
    const note = await fetch(`${coreApiUrl}/admin/rest/deal_notes`, {
      method: "POST",
      headers: { "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify({ deal_id: now.deal_id, type: "Nota", text, ...(salesId ? { sales_id: salesId } : {}) }),
    });
    trace("guion", "POST", "/admin/rest/deal_notes", { deal_id: now.deal_id, type: "Nota", text }, note.status, { resultado: "sin cuerpo (201)" });
    check(note.status === 201, "[guion] Quedó una nota en el negocio con el desglose");
    console.log(`   👀 Se refleja en el CRM: el negocio pasó a "Cotizado" por $${money(total)}, con una nota con el desglose.`);
  }
  if (step === 4) {
    const task = (
      await db.query("select t.text, t.due_date from public.tasks t join public.contacts c on c.id = t.contact_id where c.phone_jsonb @> jsonb_build_array(jsonb_build_object('number', $1::text)) order by t.id desc limit 1", [`+${phone}`])
    ).rows[0];
    check(Boolean(task), "Se creó una tarea de seguimiento");
    if (task) console.log(`   👀 Se refleja en el CRM: tarea nueva «${String(task.text).slice(0, 90)}».`);
  }
} catch (error) {
  check(false, (error as Error).message);
} finally {
  await db.end();
  await new Promise<void>((done) => bot.close(() => done()));
  await waha.close();
}
process.exitCode = checks.every((entry) => entry.ok) ? 0 : 1;
