import { createHmac, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type pg from "pg";
import { connect, owner, requireEnv } from "../scripts/db-lib.ts";

export const TEST_DB = "salvionix_test";
export const POSTGREST_TEST_URL = process.env.POSTGREST_TEST_URL ?? "http://127.0.0.1:55301";

/** CI passes the variables directly; locally they come from the git-ignored file. */
export const loadLocalEnv = (): void => {
  const file = resolve(import.meta.dirname, "../../infra/local/.env");
  if (!process.env.PG_SUPERUSER_PASSWORD && existsSync(file)) process.loadEnvFile(file);
};
loadLocalEnv();

export const ownerClient = () => owner(TEST_DB);
export const coreApiClient = () => connect("core_api", requireEnv("CORE_API_PASSWORD"), TEST_DB);

export type Lead = { contactId: number; dealId: number };

export const createLead = async (db: pg.Client, { isTest = false } = {}): Promise<Lead> => {
  const contact = await db.query<{ id: number }>(
    "insert into public.contacts (first_name, last_name, is_test) values ($1, $2, $3) returning id::int",
    ["Lead", randomUUID().slice(0, 8), isTest],
  );
  const contactId = contact.rows[0].id;
  const deal = await db.query<{ id: number }>(
    `insert into public.deals (name, stage, contact_ids, primary_contact_id, is_test)
     values ('Service', 'opportunity', array[$1::bigint], $1, $2) returning id::int`,
    [contactId, isTest],
  );
  return { contactId, dealId: deal.rows[0].id };
};

export const createTechnician = async (db: pg.Client): Promise<number> => {
  const { rows } = await db.query<{ id: number }>(
    "insert into core.technicians (brand_id, name) values (1, 'Test Technician') returning id::int",
  );
  return rows[0].id;
};

type AppointmentRow = {
  id: number;
  status: string;
  is_test: boolean;
  blocked_until: Date;
  hold_expires_at: Date | null;
  confirmed_at: Date | null;
};

/** Raw insert, the way a bug or a direct connection would do it: only the database stops it. */
export const insertHold = async (
  db: pg.Client,
  lead: Lead,
  technicianId: number,
  startAt: string,
  endAt: string,
  extra: { holdExpiresAt?: string } = {},
): Promise<AppointmentRow> => {
  const { rows } = await db.query<AppointmentRow>(
    `insert into core.appointments (deal_id, contact_id, technician_id, start_at, end_at, hold_expires_at, blocked_until, brand_id)
     values ($1, $2, $3, $4, $5, $6, $5, 1)
     returning id::int, status, is_test, blocked_until, hold_expires_at, confirmed_at`,
    [lead.dealId, lead.contactId, technicianId, startAt, endAt, extra.holdExpiresAt ?? null],
  );
  return rows[0];
};

export const setStatus = (db: pg.Client, id: number, status: string) =>
  db.query("update core.appointments set status = $1 where id = $2", [status, id]);

export const createQuote = async (db: pg.Client, dealId: number): Promise<number> => {
  const { rows } = await db.query<{ id: number }>(
    `insert into core.quotes (deal_id, covered_sqft, uncovered_sqft, inputs)
     values ($1, 1860, 0, '{}') returning id::int`,
    [dealId],
  );
  return rows[0].id;
};

const base64Url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** Signs the way core-api will: HS256 with the PostgREST secret. */
export const signPanelToken = (claims: object, secret = requireEnv("PGRST_JWT_SECRET")): string => {
  const now = Math.floor(Date.now() / 1000);
  const head = `${base64Url({ alg: "HS256", typ: "JWT" })}.${base64Url({ iat: now, exp: now + 300, ...claims })}`;
  return `${head}.${createHmac("sha256", secret).update(head).digest("base64url")}`;
};

export const waitForPostgrest = async (): Promise<void> => {
  const token = signPanelToken({ role: "crm_api", sub: randomUUID() });
  const deadline = Date.now() + 100_000;
  let lastStatus: number | string = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${POSTGREST_TEST_URL}/appointments_summary?limit=1`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      lastStatus = response.status;
      if (response.ok) return;
    } catch {
      lastStatus = "connection refused";
    }
    await new Promise((done) => setTimeout(done, 1_000));
  }
  throw new Error(`PostgREST test instance not ready: ${lastStatus}. Is the local stack up (npm run local:up)?`);
};
