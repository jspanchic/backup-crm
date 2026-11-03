import type pg from "pg";
import { fakePhone, sendInbound, sendTwice, type SimConfig, type WahaServer } from "./waha-sim.ts";

export type Check = { ok: boolean; label: string };

export type DemoDeps = {
  sim: SimConfig;
  waha: WahaServer;
  /** A connection that can read the database, to check what the system really stored. */
  db: pg.Client;
  print?: (line: string) => void;
};

const DAY_MS = 86_400_000;

/**
 * The demo, step by step. Everything the customers see goes through the real door (a signed webhook to
 * core-api and the messages WAHA would send); what the system stored is checked in the database. It runs
 * with the scripted bot or with Javier in n8n: the checks do not depend on the exact words.
 * The phone numbers are fictitious and new on every run.
 */
export const runDemo = async ({ sim, waha, db, print = console.log }: DemoDeps): Promise<{ checks: Check[] }> => {
  const checks: Check[] = [];
  const check = (ok: boolean, label: string) => {
    checks.push({ ok, label });
    print(`   ${ok ? "✅" : "❌"} ${label}`);
  };
  const step = (title: string) => print(`\n━━ ${title}`);
  const one = async <T = any>(sql: string, values: unknown[] = []): Promise<T | undefined> => (await db.query(sql, values)).rows[0] as T | undefined;
  const quoted = (text: string) => text.split("\n").map((line, index) => (index === 0 ? line : `        ${line}`)).join("\n");

  /** `nickname` is what WhatsApp shows for the contact; `name` is who they say they are. */
  const customer = (name: string, nickname: string, phone = fakePhone()) => {
    const speak = async (text: string, options: { replies?: number; sentAt?: Date } = {}): Promise<string[]> => {
      const before = waha.to(phone).length;
      print(`   👤 ${name}: ${text}`);
      const sent = await sendInbound(sim, { phone, text, pushName: nickname, sentAt: options.sentAt });
      if (sent.status !== 200) throw new Error(`core-api answered ${sent.status} to a signed message`);
      const replies = options.replies ?? 1;
      if (replies === 0) return [];
      const all = await waha.waitFor(phone, before + replies);
      const fresh = all.slice(before).map((message) => message.text);
      for (const reply of fresh) print(`   🤖 Javier: ${quoted(reply)}`);
      return fresh;
    };
    const silence = async (text: string, waitMs = 1_500): Promise<number> => {
      const before = waha.to(phone).length;
      print(`   👤 ${name}: ${text}`);
      await sendInbound(sim, { phone, text, pushName: nickname });
      await new Promise((done) => setTimeout(done, waitMs));
      return waha.to(phone).length - before;
    };
    return { name, phone, speak, silence };
  };
  type Customer = ReturnType<typeof customer>;

  const holder = (c: Customer) => one<{ contact: number; conversation: number; deal: number }>(
    `select h.contact_id::int as contact,
            (select id::int from core.conversations cv where cv.identity_id = i.id order by id desc limit 1) as conversation,
            (select d.id::int from public.deals d where d.primary_contact_id = h.contact_id order by d.id desc limit 1) as deal
     from core.contact_identities i join core.identity_holders h on h.identity_id = i.id and h.valid_to is null
     where i.value = $1`,
    [`+${c.phone}`],
  );
  const slotLabel = (reply: string, index: number) => reply.match(new RegExp(`^${index}\\. (.+)$`, "m"))?.[1];
  const total = (reply: string) => Number(reply.match(/VALOR ESTIMADO: \$([\d,.]+)/)?.[1].replaceAll(",", ""));

  /** Takes a customer from the first hello to the list of times. Returns the list as the customer read it. */
  const untilTimes = async (c: Customer, bedrooms: string): Promise<string> => {
    await c.speak("Hola");
    await c.speak(`Me llamo ${c.name}`);
    await c.speak("Es para mi casa");
    const replies = await c.speak(bedrooms, { replies: 2 });
    return replies[1];
  };

  const carlos = customer("Carlos Pérez", "Carlitos");
  const ana = customer("Ana Gómez", "Anita");
  const rosa = customer("Rosa Salazar", "Rosi");
  const tester = customer("Prueba Sebas", "Sebas");
  const marta = customer("Marta", "Marty");

  // ------------------------------------------------------------------ 1
  step("1 · Cliente nuevo");
  const hello = await carlos.speak("Hola, quiero información sobre la desinfección");
  check(/con quién tengo el gusto/i.test(hello[0]), "Javier saluda y pide el nombre");
  await carlos.speak("Me llamo Carlos Pérez");
  await carlos.speak("Es para mi casa");
  const first = await holder(carlos);
  const contact = await one(`select first_name, last_name, is_test, sales_id from public.contacts where id = $1`, [first!.contact]);
  check(contact?.first_name === "Carlos" && contact?.last_name === "Pérez", "el CRM guardó el nombre: Carlos Pérez");
  check(contact?.is_test === false, "es un cliente real, no una prueba");
  check(contact?.sales_id !== null, "tiene un responsable asignado (el responsable por defecto de la marca)");
  check((await one(`select stage from public.deals where id = $1`, [first!.deal]))?.stage === "contacted", "la oportunidad pasó a Contactado");
  check((await one(`select count(*)::int as n from core.messages where conversation_id = $1`, [first!.conversation]))!.n >= 6, "la conversación quedó guardada en el CRM");

  // ------------------------------------------------------------------ 2
  step("2 · El cliente vuelve y es reconocido");
  const again = await carlos.speak("Hola otra vez");
  check(/hola de nuevo, carlos/i.test(again[0]), "Javier lo reconoce por el teléfono y lo llama por su nombre");
  const second = await holder(carlos);
  check(second!.contact === first!.contact && second!.conversation === first!.conversation, "sigue siendo el mismo contacto y la misma conversación");
  check((await one(`select count(*)::int as n from core.contact_identities where value = $1`, [`+${carlos.phone}`]))!.n === 1, "el teléfono está guardado una sola vez, en formato internacional");

  // ------------------------------------------------------------------ 3
  step("3 · Cotización");
  const quoteReplies = await carlos.speak("Tiene 3 dormitorios y garage techado para 2 autos", { replies: 2 });
  const stored = await one(`select total::float, subtotal::float, price_confirmed from core.quotes where deal_id = $1 and status = 'sent'`, [first!.deal]);
  check(stored?.total === total(quoteReplies[0]), `el monto que dijo Javier ($${total(quoteReplies[0])}) es el que calculó la base ($${stored?.total})`);
  const expectedArea = await one(
    `select covered_sqft::float as covered from core.quote_area(core.active_price_list(1), '{"client_type":"home","bedrooms":3,"covered_parking_cars":2}'::jsonb)`,
  );
  const area = await one(`select covered_sqft::float as covered, uncovered_sqft::float as uncovered from core.quotes where deal_id = $1 and status = 'sent'`, [first!.deal]);
  check(area?.covered === expectedArea?.covered && area!.covered > 1000, `Javier entendió una casa de 3 dormitorios con garage para 2 autos: ${area?.covered} pies cuadrados cubiertos, como lo calcula la base`);
  check(stored?.price_confirmed === false, "la cotización lleva marcado que los precios son de ejemplo, por confirmar");
  check((await one(`select stage from public.deals where id = $1`, [first!.deal]))?.stage === "proposal-sent", "la oportunidad pasó a Propuesta enviada");
  check(/1\. /.test(quoteReplies[1]), "después de cotizar, Javier ofrece horarios libres");

  // ------------------------------------------------------------------ 4
  step("4 · Horarios libres, reserva y confirmación");
  const anaTimes = await untilTimes(ana, "2 dormitorios");
  const slot = slotLabel(quoteReplies[1], 1)!;
  check(slotLabel(anaTimes, 1) === slot, "otra clienta (Ana) ve el mismo primer horario libre, todavía");
  const held = await carlos.speak("1");
  check(held[0].includes(slot), "Carlos reserva el primer horario: queda reservado 15 minutos");
  const hold = await one(`select a.id::int, a.status, a.technician_id::int, a.start_at from core.appointments a where a.deal_id = $1`, [first!.deal]);
  check(hold?.status === "hold", "en la base la cita está reservada (hold), ligada a su oportunidad");
  await carlos.speak("123 Demo Street, Orlando, FL 32801");
  const confirmation = await carlos.speak("Sí, confirmo");
  check(confirmation[0].startsWith("Gracias por elegirnos") && confirmation[0].includes(slot), "el mensaje de confirmación lo escribe core-api con el día y la hora de la cita");
  const closed = await one(`select a.status, a.address, d.stage from core.appointments a join public.deals d on d.id = a.deal_id where a.id = $1`, [hold!.id]);
  check(closed?.status === "confirmed" && closed?.stage === "won", "la cita quedó confirmada y la oportunidad en Servicio contratado");
  check((await one(`select count(*)::int as n from public.tasks where contact_id = $1 and type = 'follow-up'`, [first!.contact]))!.n === 1, "se creó la tarea de seguimiento");

  // ------------------------------------------------------------------ 5
  step("5 · Intento de cruce rechazado");
  const rejected = await ana.speak("1");
  check(/ya no está disponible/i.test(rejected[0]), "Ana elige el horario que ya tomó Carlos: Javier le dice que ya no está libre");
  const taken = await one(`select count(*)::int as n from core.appointments where technician_id = $1 and start_at = $2 and status in ('hold', 'confirmed') and not is_test`, [hold!.technician_id, hold!.start_at]);
  check(taken!.n === 1, "en la agenda sigue habiendo una sola cita en ese horario");
  const anaIds = await holder(ana);
  let violation = "";
  try {
    await db.query(
      `insert into core.appointments (deal_id, contact_id, technician_id, start_at, end_at, address)
       select $1, $2, a.technician_id, a.start_at + interval '30 minutes', a.end_at + interval '30 minutes', 'cruce a la fuerza'
       from core.appointments a where a.id = $3`,
      [anaIds!.deal, anaIds!.contact, hold!.id],
    );
  } catch (error) {
    violation = (error as { code?: string }).code ?? "";
  }
  check(violation === "23P01", "aunque alguien intente insertar el cruce directo en la base, la base lo rechaza (restricción de exclusión)");

  // ------------------------------------------------------------------ 6
  step("6 · Escalar a una persona");
  await rosa.speak("Hola");
  await rosa.speak("Me llamo Rosa Salazar");
  const handoff = await rosa.speak("Prefiero hablar con una persona, por favor");
  check(/persona del equipo/i.test(handoff[0]), "Javier avisa que pasa a una persona");
  const rosaIds = await holder(rosa);
  check((await one(`select bot_paused from core.conversations where id = $1`, [rosaIds!.conversation]))?.bot_paused === true, "el bot quedó pausado en esa conversación");
  const task = await one(`select t.text, s.first_name from public.tasks t left join public.sales s on s.id = t.sales_id where t.contact_id = $1`, [rosaIds!.contact]);
  check(Boolean(task?.text.startsWith("Atender a mano")), "se creó una tarea para atenderla a mano");
  check(Boolean(task?.first_name), `la tarea quedó asignada a ${task?.first_name ?? "nadie"}, el responsable configurado para la marca`);
  const unanswered = await rosa.silence("¿Hay alguien ahí?");
  check(unanswered === 0, "mientras está pausado, el bot no contesta");
  check((await one(`select count(*)::int as n from core.messages where conversation_id = $1 and direction = 'in'`, [rosaIds!.conversation]))!.n === 4, "pero los mensajes de Rosa se siguen guardando para la persona");

  // ------------------------------------------------------------------ 7
  step('7 · "Prueba X"');
  await tester.speak("Hola");
  await tester.speak("Me llamo Prueba Sebas");
  const testIds = await holder(tester);
  const flags = await one(`select c.is_test as contact, d.is_test as deal from public.contacts c join public.deals d on d.primary_contact_id = c.id where c.id = $1`, [testIds!.contact]);
  check(flags?.contact === true && flags?.deal === true, 'por llamarse "Prueba…", el contacto y la oportunidad quedaron marcados como prueba');
  await tester.speak("Es para mi casa");
  const testTimes = await tester.speak("3 dormitorios", { replies: 2 });
  const testSlot = slotLabel(testTimes[1], 1)!;
  check(testSlot !== slot, "el horario de Carlos ya no se le ofrece: la agenda real lo tiene ocupado");
  await tester.speak("1");
  const testAppointment = await one(`select id::int, technician_id::int, start_at, is_test from core.appointments where deal_id = $1`, [testIds!.deal]);
  check(testAppointment?.is_test === true, "la cita de prueba quedó marcada como prueba");
  const anaRetry = await ana.speak("1");
  check(anaRetry[0].includes(testSlot), "Ana puede reservar ese mismo horario: la cita de prueba no bloquea la agenda real");
  const both = await one(`select count(*)::int as n from core.appointments where technician_id = $1 and start_at = $2 and status = 'hold'`, [testAppointment!.technician_id, testAppointment!.start_at]);
  check(both!.n === 2, "ese horario tiene dos citas: la de Ana (real) y la de prueba");

  // ------------------------------------------------------------------ 8
  step("8 · Número reasignado");
  const long = new Date(Date.now() - 100 * DAY_MS);
  await marta.speak("Hola", { sentAt: long });
  await marta.speak("Me llamo Marta", { sentAt: new Date(long.getTime() + 60_000) });
  const oldIds = await holder(marta);
  const question = await marta.speak("Hola, ¿quién me escribe?");
  check(/sigues siendo marta/i.test(question[0]), "pasaron más de 90 días: Javier confirma el nombre antes de usar los datos viejos");
  const answer = await marta.speak("No, soy Pedro, este número ahora es mío");
  check(/pedro/i.test(answer[0]), "al decir que es otra persona, Javier empieza de cero con Pedro");
  const holders = (await db.query(`select h.contact_id::int as contact, h.valid_to is null as open, h.closed_reason from core.identity_holders h join core.contact_identities i on i.id = h.identity_id where i.value = $1 order by h.id`, [`+${marta.phone}`])).rows;
  check(holders.length === 2 && holders[0].open === false && holders[0].closed_reason === "reassigned_confirmed" && holders[1].open === true, "el titular anterior quedó cerrado y hay un titular nuevo");
  const kept = await one(`select c.first_name, (select count(*)::int from core.messages m where m.conversation_id = $2) as messages from public.contacts c where c.id = $1`, [oldIds!.contact, oldIds!.conversation]);
  check(kept?.first_name === "Marta" && kept!.messages >= 2, "Marta sigue en el CRM con su historial: no se perdió nada");
  const pedro = await one(`select first_name from public.contacts where id = $1`, [holders[1].contact]);
  check(pedro?.first_name === "Pedro", "Pedro es un contacto nuevo, sin los datos de Marta");

  // ------------------------------------------------------------------ extra
  step("Extra · Mensajes que no deben pasar");
  const probe = customer("Probador", "Probador");
  const [original, duplicate] = await sendTwice(sim, { phone: probe.phone, text: "Hola, mensaje repetido", pushName: "Probador" });
  await waha.waitFor(probe.phone, 1);
  await new Promise((done) => setTimeout(done, 800));
  check((original.body as { status: string }).status === "accepted" && (duplicate.body as { status: string }).status === "duplicate", "el mismo mensaje entregado dos veces se descarta la segunda vez");
  check(waha.to(probe.phone).length === 1, "y Javier contesta una sola vez");
  const badSim = { ...sim, hmacSecret: "x".repeat(40) };
  const forged = await sendInbound(badSim, { phone: probe.phone, text: "mensaje falso" });
  check(forged.status === 401, "un mensaje con firma falsa se rechaza con 401 y no cambia nada");

  const failed = checks.filter((entry) => !entry.ok).length;
  print(`\n${failed === 0 ? "✅" : "❌"} ${checks.length - failed} de ${checks.length} comprobaciones correctas${failed ? ` (${failed} fallaron)` : ""}`);
  return { checks };
};
