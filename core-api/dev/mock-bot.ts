import { createServer, type Server } from "node:http";
import { safeEqualHex, signBotRequest } from "../src/signature.ts";

/**
 * A scripted bot with the same shape of call as the real one (n8n): it receives the signed POST of the
 * contract, answers 200, and then works through the tools with the token it was given, using only
 * what the contract and the tools return. It has no Claude and no memory of its own: the state of the
 * conversation is what `ficha` and `historial` say. It exists so the demo and the tests are deterministic.
 */

type Contract = {
  token: string;
  mensaje: { id: string; texto: string };
  contacto: { nombre: string | null; nuevo: boolean; reverificar: boolean };
  historial: { de: string; texto: string }[];
};

type Ficha = {
  nombre: string | null;
  tipo_cliente: string | null;
  direccion: string | null;
  cotizacion_vigente: { total: number; subtotal: number; discount: number; min_applied: boolean } | null;
  cita: { status: string } | null;
};

export type MockBotCall = { path: string; status: number; reason?: string };

export type MockBot = {
  url: string;
  calls: MockBotCall[];
  close: () => Promise<void>;
};

const money = (value: number): string => value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const asked = (history: Contract["historial"], fragment: string): boolean => {
  const last = [...history].reverse().find((entry) => entry.de === "bot");
  return Boolean(last && last.texto.toLowerCase().includes(fragment));
};

const nameFrom = (text: string, wasAsked: boolean): string | null => {
  const direct = text.match(/(?:me llamo|soy|mi nombre es)\s+([\p{L}][\p{L} .'-]{1,60})/iu);
  if (direct) return direct[1].trim();
  return wasAsked && /^[\p{L}][\p{L} .'-]{1,60}$/u.test(text.trim()) ? text.trim() : null;
};

const numbersIn = (text: string): number[] => [...text.replaceAll(",", "").matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));

export const startMockBot = async (options: {
  port: number;
  coreApiUrl: string;
  botHmacSecret: string;
  path?: string;
  host?: string;
  log?: (line: string) => void;
}): Promise<MockBot> => {
  const path = options.path ?? "/webhook/javier-core-api";
  const calls: MockBotCall[] = [];
  const handled = new Set<string>();
  // What each conversation was last offered, so that "the first one" means the one the customer read, even
  // if somebody else takes it a moment later. This is the one thing the script remembers; it reads the
  // conversation id from the token it was given, which is public information (the claims are not secret).
  const offered = new Map<number, { inicio: string; texto: string }[]>();
  const conversationOf = (token: string): number => Number(JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).cnv);
  const log = options.log ?? (() => {});

  const tool = async (token: string, method: "GET" | "POST", name: string, body?: unknown) => {
    const response = await fetch(`${options.coreApiUrl}/tools/${name}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, any>;
    calls.push({ path: name, status: response.status, reason: json.reason ?? json.error });
    return { status: response.status, json };
  };

  const handle = async (contract: Contract): Promise<void> => {
    const { token, mensaje, contacto, historial } = contract;
    const text = mensaje.texto.trim();

    const say = async (reply: string) => {
      const result = await tool(token, "POST", "responder", { texto: reply });
      if (result.status === 422) {
        // The review stopped the text: say the safe thing, as a bot that read the reason would.
        log(`  (la revisión frenó la respuesta: ${result.json.reason})`);
        await tool(token, "POST", "responder", { texto: "Un momento, por favor." });
      }
    };

    const offer = async (intro: string) => {
      const slots = await tool(token, "POST", "horarios_libres", { dias: 7 });
      const list = (slots.json.horarios as { inicio: string; texto: string }[] | undefined)?.slice(0, 3) ?? [];
      offered.set(conversationOf(token), list);
      if (!list.length) return say("Por ahora no tengo horarios libres. Una persona del equipo te contactará.");
      return say(`${intro}\n${list.map((slot, index) => `${index + 1}. ${slot.texto}`).join("\n")}\n¿Cuál te queda mejor?`);
    };

    const ficha = (await tool(token, "GET", "ficha")).json as Ficha;

    // A person was asked for: the bot says so first, because once paused it can no longer talk.
    if (/\b(humano|persona|asesor|supervisor)\b/i.test(text)) {
      await say("Claro, te comunico con una persona del equipo. En breve te atienden.");
      await tool(token, "POST", "escalar", { motivo: `El cliente pidió hablar con una persona: "${text.slice(0, 120)}"` });
      return;
    }

    // The number may have a new owner.
    if (asked(historial, "sigues siendo")) {
      if (/^\s*(s[ií]|claro|correcto|as[ií] es)\b/i.test(text)) {
        await tool(token, "POST", "confirmar_titular", { es_la_misma_persona: true });
        return say(`Gracias, ${ficha.nombre}. ¿En qué te ayudo?`);
      }
      const newName = nameFrom(text, false);
      await tool(token, "POST", "confirmar_titular", { es_la_misma_persona: false, ...(newName ? { nombre_nuevo: newName } : {}) });
      return say(`Mucho gusto${newName ? `, ${newName}` : ""}. ¿Tu servicio es para un hogar o para una empresa?`);
    }
    if (contacto.reverificar && ficha.nombre) {
      return say(`Hola, ¿sigues siendo ${ficha.nombre}?`);
    }

    const greeting = /^\s*(hola|buenas|buenos|hello|hi)\b/i.test(text);
    const back = greeting && ficha.nombre ? `Hola de nuevo, ${ficha.nombre}. ` : "";

    // 1. Name. The name WhatsApp shows is only a nickname: Javier always asks who he is talking to.
    const askedName = asked(historial, "tengo el gusto");
    if (askedName || !ficha.nombre || (contacto.nuevo && historial.length === 0)) {
      const name = nameFrom(text, askedName);
      if (!name) return say("Hola, soy Javier, tu asesor. ¿Con quién tengo el gusto?");
      await tool(token, "POST", "guardar_datos", { nombre: name });
      return say(`Mucho gusto, ${name}. ¿Tu servicio es para un hogar o para una empresa?`);
    }

    // 2. Type of customer
    if (!ficha.tipo_cliente) {
      const kind = /empresa|negocio|oficina|local/i.test(text) ? "empresa" : /hogar|casa|depa|departamento/i.test(text) ? "hogar" : null;
      if (!kind) return say(`${back}¿Tu servicio es para un hogar o para una empresa?`);
      await tool(token, "POST", "guardar_datos", { tipo_cliente: kind });
      return say(kind === "hogar" ? "Perfecto. ¿Cuántos dormitorios tiene y cuántos autos caben en el garage techado?" : "Perfecto. ¿Cuántos pies cuadrados cubiertos tiene tu empresa?");
    }

    // 3. Quote
    if (!ficha.cotizacion_vigente) {
      const [first, second] = numbersIn(text);
      if (first === undefined) {
        return say(`${back}${ficha.tipo_cliente === "hogar" ? "¿Cuántos dormitorios tiene y cuántos autos caben en el garage techado?" : "¿Cuántos pies cuadrados cubiertos tiene tu empresa?"}`);
      }
      const input = ficha.tipo_cliente === "hogar"
        ? { tipo_cliente: "hogar", dormitorios: first, autos_techados: second ?? 0 }
        : { tipo_cliente: "empresa", pies_cubiertos: first };
      const quote = (await tool(token, "POST", "cotizar", input)).json;
      const lines = quote.minimo_aplicado
        ? [`*VALOR ESTIMADO: $${money(quote.total)}*`, "- Valor mínimo por servicio."]
        : [
            `- Subtotal: *$${money(quote.subtotal)}*`,
            `- Descuento especial (${quote.descuento_pct}%): *-$${money(quote.descuento)}*`,
            `*VALOR ESTIMADO: $${money(quote.total)}*`,
          ];
      await say([`*COTIZACIÓN*`, `- Área cubierta: *${money(quote.pies_cubiertos)}* pies cuadrados`, ...lines, "- Valor sujeto a revisión final en la visita."].join("\n"));
      return offer("¿En qué fecha te gustaría el servicio? Tengo estos horarios libres:");
    }

    // 4. Time
    if (!ficha.cita) {
      const list = offered.get(conversationOf(token)) ?? ((await tool(token, "POST", "horarios_libres", { dias: 7 })).json.horarios as { inicio: string; texto: string }[]) ?? [];
      const choice = numbersIn(text)[0];
      if (!choice || choice < 1 || choice > Math.min(3, list.length)) return offer(`${back}Estos son los horarios que tengo libres:`);
      const picked = list[choice - 1];
      const held = await tool(token, "POST", "reservar", { inicio: picked.inicio });
      if (held.status === 409) {
        return offer("Ese horario ya no está disponible. Estos otros sí lo están:");
      }
      return say(`Te reservo ${picked.texto} por 15 minutos. Ahora necesito la dirección exacta del lugar donde haremos el servicio.`);
    }

    // 5. Address and confirmation
    if (ficha.cita.status === "hold") {
      if (!ficha.direccion) {
        if (text.length < 6) return say("¿Me das la dirección exacta del lugar del servicio, con calle y número?");
        await tool(token, "POST", "guardar_datos", { direccion: text });
        return say(`Perfecto. Repito la dirección: ${text}. ¿Confirmas la orden de compra?`);
      }
      if (/\b(s[ií]|confirmo|ok|dale|listo)\b/i.test(text)) {
        // The confirmation message is written and sent by core-api.
        await tool(token, "POST", "confirmar", {});
        return;
      }
      return say("¿Confirmas la orden de compra?");
    }

    return say(`${back}Tu servicio ya quedó agendado. ¿Te ayudo con algo más?`);
  };

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const timestamp = Number(request.headers["x-core-timestamp"]);
      const signature = String(request.headers["x-core-signature"] ?? "");
      const fresh = Number.isFinite(timestamp) && Math.abs(Date.now() / 1000 - timestamp) < 300;
      const valid = request.method === "POST" && request.url === path && fresh && safeEqualHex(signature, signBotRequest(options.botHmacSecret, timestamp, raw));
      if (!valid) {
        response.writeHead(401).end();
        return;
      }
      // Answer first, work after: the same thing the real flow does.
      response.writeHead(200).end();
      try {
        const contract = JSON.parse(raw) as Contract;
        if (handled.has(contract.mensaje.id)) return;
        handled.add(contract.mensaje.id);
        void handle(contract).catch((error: Error) => log(`  (el bot de guion falló: ${error.message})`));
      } catch (error) {
        log(`  (cuerpo inválido: ${(error as Error).message})`);
      }
    });
  });
  await new Promise<void>((done) => server.listen(options.port, options.host ?? "127.0.0.1", done));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  return {
    url: `http://${options.host ?? "127.0.0.1"}:${port}${path}`,
    calls,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
};
