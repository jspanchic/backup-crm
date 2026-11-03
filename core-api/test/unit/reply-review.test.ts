import { describe, expect, it } from "vitest";
import { findAmounts, reviewReply, type ReplyFacts } from "../../src/reply-review.ts";

const facts = (overrides: Partial<ReplyFacts> = {}): ReplyFacts => ({
  timezone: "America/New_York",
  currency: "USD",
  allowed_reply_domains: ["salvionix.com", "bioseguridad.bytogam.com"],
  phone_e164: "+12025550123",
  rates: { covered: 0.12, uncovered: 0.06, discount_pct: 7, min_total: 150 },
  quote: { total: 1060, subtotal: 1140, discount: 80, covered_cost: 960, uncovered_cost: 180 },
  appointment: null,
  offered_slots: [],
  ...overrides,
});

// 2030-06-04 is a Tuesday. 15:00 UTC is 11:00 in New York (summer time).
const confirmed = (): ReplyFacts =>
  facts({ appointment: { status: "confirmed", start_at: "2030-06-04T15:00:00Z", end_at: "2030-06-04T16:00:00Z" } });
const held = (): ReplyFacts =>
  facts({ appointment: { status: "hold", start_at: "2030-06-04T15:00:00Z", end_at: "2030-06-04T16:00:00Z" } });

const reason = (text: string, f: ReplyFacts) => {
  const result = reviewReply(text, f);
  return result.ok ? "ok" : result.reason;
};

describe("finding amounts", () => {
  it.each([
    ["$1,060", [1060]],
    ["*VALOR ESTIMADO: $1,060*", [1060]],
    ["Descuento especial (7%): *-$80*", [80]],
    ["a $0.12 por pie cuadrado y $0.06 por pie", [0.12, 0.06]],
    ["USD 150", [150]],
    ["US$ 150.50", [150.5]],
    ["150 dólares", [150]],
    ["150 dolares", [150]],
    ["150 USD", [150]],
    ["1,060 dollars", [1060]],
    ["$ 485", [485]],
  ])("reads %s", (text, expected) => {
    expect(findAmounts(text)).toEqual(expected);
  });

  it.each(["zip 32801", "somos 3 personas", "1,860 pies cuadrados", "el 7% de descuento", "cotización N° 501", "2 autos"])(
    "does not read %s as money",
    (text) => {
      expect(findAmounts(text)).toEqual([]);
    },
  );
});

describe("amounts must come from the quote", () => {
  it.each([
    "El total es *$1,060*",
    "Subtotal $1,140, descuento -$80, total $1,060",
    "Cubierto $960 y descubierto $180",
    "Valores a $0.12 por pie cuadrado cubierto y $0.06 por pie descubierto",
    "El mínimo por servicio es $150",
    "1060 dólares",
  ])("lets through: %s", (text) => {
    expect(reason(text, facts())).toBe("ok");
  });

  it.each([
    ["a different total", "El total es $1,000"],
    ["a made up discount", "Te hago un 20% y queda en $848"],
    ["a total off by a dollar", "Son $1,061"],
    ["one wrong among right ones", "Subtotal $1,140, descuento -$100, total $1,060"],
    ["a price in dollars written after", "Son 900 dólares"],
    ["a price with the code", "USD 950"],
  ])("stops %s", (_name, text) => {
    expect(reason(text, facts())).toBe("amount_not_from_quote");
  });

  it("allows only the rates and the minimum before there is a quote, and says there is none", () => {
    const before = facts({ quote: null });
    expect(reason("El mínimo es $150 y el pie cubierto sale a $0.12", before)).toBe("ok");
    const stopped = reviewReply("Te costaría $400", before);
    expect(stopped).toMatchObject({ ok: false, reason: "amount_not_from_quote" });
    expect(stopped.ok === false && stopped.message).toContain("cotizar");
  });

  it("allows no amount at all with no price list", () => {
    expect(reason("Son $150", facts({ quote: null, rates: null }))).toBe("amount_not_from_quote");
  });

  it("tells the model which amounts are allowed, so it can correct itself", () => {
    const result = reviewReply("Son $999", facts());
    expect(result.ok === false && result.message).toMatch(/1060/);
  });
});

describe("a confirmation needs a confirmed appointment", () => {
  it.each([
    "Tu servicio ya quedó agendado para el martes",
    "Listo, quedó confirmado",
    "Your appointment is scheduled for Tuesday",
    "Your service is booked",
    "Todo confirmado",
    "La cita está CONFIRMADA",
  ])("stops %j when there is no appointment", (text) => {
    expect(reason(text, facts())).toBe("confirmation_without_appointment");
  });

  it("stops a confirmation while the appointment is only a hold", () => {
    expect(reason("Tu servicio quedó agendado", held())).toBe("confirmation_without_appointment");
  });

  it.each([
    "Por favor revisa y confirma esta orden de compra.",
    "¿Confirmas la dirección?",
    "Te reservo ese horario por 15 minutos",
    "¿Te queda mejor por la mañana o por la tarde?",
  ])("lets through %j, which does not claim anything", (text) => {
    expect(reason(text, facts())).toBe("ok");
  });

  describe("with a confirmed appointment on Tuesday June 4 at 11:00", () => {
    it.each([
      "Tu servicio ya quedó agendado para el martes 4 de junio a las 11:00 am.",
      "Quedó confirmado: June 4 at 11:00 AM",
      "Confirmado para el 04/06 a las 11:00",
      "Confirmed for 6/4/2030 at 11 am",
      "Confirmado el 2030-06-04, de 11:00 a 12:00",
      "Tu servicio quedó agendado. Gracias por elegirnos.",
      "Quedó agendado para el martes",
    ])("lets through %j", (text) => {
      expect(reason(text, confirmed())).toBe("ok");
    });

    it.each([
      ["another time", "Quedó agendado para el martes a las 3 pm"],
      ["a 24 hour time", "Confirmado a las 15:00"],
      ["a wrong minute", "Confirmado a las 11:30"],
    ])("stops %s", (_name, text) => {
      expect(reason(text, confirmed())).toBe("time_mismatch");
    });

    it.each([
      ["another day of the week", "Quedó agendado para el miércoles a las 11:00"],
      ["another date in words", "Confirmado para el 5 de junio"],
      ["another date in English", "Confirmed for June 5"],
      ["another numeric date", "Confirmado el 07/06"],
      ["another month", "Confirmado el 4 de julio"],
      ["a wrong ISO date", "Confirmado el 2030-06-05"],
    ])("stops %s", (_name, text) => {
      expect(reason(text, confirmed())).toBe("date_mismatch");
    });

    it("reads the time in the brand's time zone, not in UTC", () => {
      expect(reason("Quedó agendado a las 15:00", confirmed())).toBe("time_mismatch");
      expect(reason("Quedó agendado a las 11:00", confirmed())).toBe("ok");
    });

    it("follows a change of time zone rules: the same UTC hour is 10:00 in winter, ending at 11:00", () => {
      const winter = facts({ appointment: { status: "confirmed", start_at: "2030-01-08T15:00:00Z", end_at: "2030-01-08T16:00:00Z" } });
      expect(reason("Quedó agendado a las 10:00", winter)).toBe("ok");
      expect(reason("Quedó agendado a las 12:00", winter)).toBe("time_mismatch");
    });
  });
});

describe("links", () => {
  it.each([
    "Mira https://salvionix.com/servicios",
    "Visita bioseguridad.bytogam.com",
    "https://www.salvionix.com",
    "Escríbenos a hola@salvionix.com",
  ])("lets through %j", (text) => {
    expect(reason(text, facts())).toBe("ok");
  });

  it.each([
    "Mira https://evil.example.com/pagar",
    "Entra a www.pagos-rapidos.com",
    "Visita pagos.io para pagar",
    "http://salvionix.com.evil.net/x",
    "https://notsalvionix.com",
  ])("stops %j", (text) => {
    expect(reason(text, facts())).toBe("url_not_allowed");
  });

  it("allows no link when the brand has no allowed domains", () => {
    expect(reason("Mira https://salvionix.com", facts({ allowed_reply_domains: [] }))).toBe("url_not_allowed");
  });

  it("does not take an email of the customer for a link", () => {
    expect(reason("Te escribo a ana@gmail.com", facts())).toBe("ok");
  });
});

describe("phone numbers", () => {
  it.each(["Tu celular es (202) 555-0123", "Llama al +1 202 555 0123", "al 2025550123", "5934 1234 5678"])("stops %j", (text) => {
    expect(reason(text, facts())).toBe("phone_in_reply");
  });

  it("lets the bot repeat the number through the placeholder, and a masked one", () => {
    expect(reason("Tu celular es {{telefono}}, ¿es correcto?", facts())).toBe("ok");
    expect(reason("Tu celular termina en 0123: +1••••••0123", facts())).toBe("ok");
  });

  it("stops the placeholder when the customer has no phone, and the phone is not guessed", () => {
    expect(reason("Tu celular es {{telefono}}", facts({ phone_e164: null }))).toBe("phone_unavailable");
  });

  it.each(["mi zip es 32801", "3 dormitorios y 2 autos", "el 4 de junio de 2030", "1,860 pies cuadrados", "$1,060"])(
    "does not take %j for a phone number",
    (text) => {
      expect(reason(text, facts())).toBe("ok");
    },
  );
});

describe("schedules must come from horarios_libres", () => {
  // Tuesday June 4 10:00 and Wednesday June 5 14:00 in New York (summer time, UTC-4).
  const offered = (): ReplyFacts =>
    facts({
      offered_slots: [
        { start_at: "2030-06-04T14:00:00Z", end_at: "2030-06-04T15:00:00Z" },
        { start_at: "2030-06-05T18:00:00Z", end_at: "2030-06-05T19:00:00Z" },
      ],
    });

  it.each([
    "Tengo estos horarios libres: martes 10:00 y miércoles 14:00",
    "Te queda bien el martes 4 de junio a las 10:00 AM?",
    "El miércoles 5 de junio a las 2 pm tengo libre",
    "Libre el martes de 10:00 a 11:00",
    "Tengo el miércoles de 2:00 pm a 3:00 pm",
    "Which works better: June 4 at 10 am or June 5 at 2:00 pm?",
    "¿Te queda mejor por la mañana o por la tarde?",
    "Hola, te escribo sobre tu cotización",
  ])("lets through %j", (text) => {
    expect(reason(text, offered())).toBe("ok");
  });

  it.each([
    ["a time that was never offered", "Tengo libre el martes a las 3 pm"],
    ["a time the customer proposed", "Perfecto, te agendo a las 5:30 pm"],
    ["the end time of an offered slot, alone", "El martes a las 11:00 AM te queda?"],
    ["a 24 hour time that was not offered", "¿Te sirve a las 16:00?"],
    ["an offered time on a day that was not offered", "Tengo libre el jueves a las 10:00"],
    ["a date that was not offered", "Para el servicio tengo el 10 de junio a las 10:00"],
    ["a date in the sentence of a service, with no time", "Podemos hacer el servicio el 20 de junio"],
    ["a weekday for the service that was not offered", "Tengo disponible el viernes"],
  ])("stops %s", (_name, text) => {
    expect(reason(text, offered())).toBe("schedule_not_offered");
  });

  it("stops every time while nothing was offered, and tells the model to ask first", () => {
    const result = reviewReply("Te queda bien a las 10:00?", facts());
    expect(result).toMatchObject({ ok: false, reason: "schedule_not_offered" });
    expect(result.ok === false && result.message).toContain("horarios_libres");
  });

  it("does not check the dates of a quote or its validity", () => {
    const quote = ["- Fecha de emisión: October 8, 2026", "- Vigencia de la cotización: hasta el 22 de octubre de 2026"].join("\n");
    expect(reason(quote, facts())).toBe("ok");
  });

  it("checks each sentence separately: one bad time among good ones is enough", () => {
    expect(reason("El martes a las 10:00 está libre. También el martes a las 6 pm.", offered())).toBe("schedule_not_offered");
  });

  it("lets the bot repeat the time of its own hold or appointment", () => {
    const held = facts({ appointment: { status: "hold", start_at: "2030-06-04T15:00:00Z", end_at: "2030-06-04T16:00:00Z" } });
    expect(reason("Te reservo el martes 4 de junio a las 11:00 AM por 15 minutos", held)).toBe("ok");
  });

  it("reads times in the time zone of the brand", () => {
    expect(reason("Te queda bien a las 18:00?", offered())).toBe("schedule_not_offered"); // 18:00 is the UTC hour of the Wednesday slot, not New York
    expect(reason("Te queda bien a las 10:00?", offered())).toBe("ok");
  });
});
