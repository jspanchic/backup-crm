import { randomUUID } from "node:crypto";
import type pg from "pg";
import { signConversationToken } from "../src/token.ts";
import { delivery, fakePhone, NOW, post, type TestApp } from "./app-helpers.ts";

export type Setup = { brandId: number; session: string; technicianIds: number[] };

export type SetupOptions = {
  timezone?: string;
  technicians?: number;
  weekdays?: number[];
  from?: string;
  to?: string;
  bufferMinutes?: number;
  minNoticeMinutes?: number;
  horizonDays?: number;
  isTest?: boolean;
};

/** A brand of its own, so a test cannot see the appointments of another one. */
export const createSetup = async (owner: pg.Client, options: SetupOptions = {}): Promise<Setup> => {
  const slug = `brand-${randomUUID().slice(0, 8)}`;
  const { rows } = await owner.query<{ id: number }>(
    "insert into core.brands (slug, name, timezone) values ($1, $1, $2) returning id::int",
    [slug, options.timezone ?? "UTC"],
  );
  const brandId = rows[0].id;
  await owner.query(
    `insert into core.scheduling_settings (brand_id, slot_minutes, buffer_minutes, hold_minutes, min_notice_minutes, horizon_days, reverify_after_days)
     values ($1, 60, $2, 15, $3, $4, 90)`,
    [brandId, options.bufferMinutes ?? 30, options.minNoticeMinutes ?? 120, options.horizonDays ?? 14],
  );
  await owner.query(
    `insert into core.price_lists (brand_id, version, valid_from, is_confirmed, currency, covered_rate, uncovered_rate, discount_pct,
        min_total, home_base_sqft, home_bedroom_sqft, parking_first_car_sqft, parking_extra_car_sqft, sqm_to_sqft, pace_to_ft)
     values ($1, 1, '2020-01-01', false, 'USD', 0.12, 0.06, 7, 150, 1000, 140, 240, 200, 10.76, 2.5)`,
    [brandId],
  );
  const session = `session-${slug}`;
  await owner.query(
    `insert into core.channels (brand_id, provider, identifier, bot_key, secret_ref, is_test)
     values ($1, 'waha', $2, 'javier', 'WAHA_HMAC_BYTOGAM_PRUEBAS', $3)`,
    [brandId, session, options.isTest ?? false],
  );

  const technicianIds: number[] = [];
  for (let index = 0; index < (options.technicians ?? 1); index++) {
    const technician = await owner.query<{ id: number }>(
      "insert into core.technicians (brand_id, name) values ($1, $2) returning id::int",
      [brandId, `Technician ${index + 1}`],
    );
    const id = technician.rows[0].id;
    technicianIds.push(id);
    for (const weekday of options.weekdays ?? [0, 1, 2, 3, 4, 5, 6]) {
      await owner.query(
        "insert into core.technician_availability (technician_id, weekday, start_time, end_time) values ($1, $2, $3, $4)",
        [id, weekday, options.from ?? "09:00", options.to ?? "17:00"],
      );
    }
  }
  return { brandId, session, technicianIds };
};

export type Lead = { conversationId: number; token: string; contactId: number; dealId: number; phone: { digits: string; e164: string } };

export const startLead = async (test: TestApp, owner: pg.Client, setup: Setup, options: Parameters<typeof delivery>[0] = {}): Promise<Lead> => {
  const phone = fakePhone();
  const body = delivery({ session: setup.session, from: `${phone.digits}@c.us`, ...options });
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
  const token = await signConversationToken(test.env.CONVERSATION_TOKEN_SECRET!, { brandId: setup.brandId, conversationId: row.id }, NOW);
  return { conversationId: row.id, token, contactId: row.contact_id, dealId: row.deal_id, phone };
};

export const toolCall = (test: TestApp, token: string | null, method: "GET" | "POST", path: string, payload?: unknown) =>
  test.app.inject({
    method,
    url: `/tools/${path}`,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(payload === undefined ? {} : { "content-type": "application/json" }) },
    payload: payload === undefined ? undefined : JSON.stringify(payload),
  });

/** A calendar day, in UTC, `days` from now: far enough to respect the notice, near enough for the horizon. */
export const day = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

export const at = (date: string, time: string): string => `${date}T${time}:00.000Z`;

export const sameInstant = (a: string, b: string): boolean => new Date(a).getTime() === new Date(b).getTime();

/** Free times of a day as "HH:MM" in UTC, as the bot sees them. */
export const freeTimes = async (test: TestApp, lead: Lead, date: string, days = 1): Promise<string[]> => {
  const response = await toolCall(test, lead.token, "POST", "horarios_libres", { desde: date, dias: days });
  if (response.statusCode !== 200) throw new Error(`horarios_libres answered ${response.statusCode}: ${response.body}`);
  return (response.json().horarios as { inicio: string }[]).map((slot) => new Date(slot.inicio).toISOString().slice(11, 16));
};

/**
 * Makes a hold look as if its time had run out. The trigger forbids changing a live hold on purpose,
 * so the test, which owns the database, switches it off for one statement.
 */
export const expireHold = async (owner: pg.Client, appointmentId: number): Promise<void> => {
  await owner.query("alter table core.appointments disable trigger appointments_before_update");
  try {
    await owner.query("update core.appointments set hold_expires_at = now() - interval '1 minute' where id = $1", [appointmentId]);
  } finally {
    await owner.query("alter table core.appointments enable trigger appointments_before_update");
  }
};

export const appointmentsOf = async (owner: pg.Client, dealId: number) =>
  (await owner.query("select id::int, status, start_at, technician_id::int, address, is_test from core.appointments where deal_id = $1 order by id", [dealId])).rows;
