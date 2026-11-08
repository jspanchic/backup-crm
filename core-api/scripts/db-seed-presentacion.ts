// Loads the presentation data (fictitious, every row is_test). With --reset it first empties what customers
// and the bot create, so the show starts clean. Configuration (brands, channels, prices, technicians) stays.
// Only for the presentation database: it refuses to run without --yes-presentation-db.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type pg from "pg";
import { loadConfig } from "../src/config.ts";
import { issueDocument } from "../src/documents/service.ts";
import { gotenbergRenderer, PdfEngineError } from "../src/documents/gotenberg.ts";
import { DB_DIR, owner, readText } from "./db-lib.ts";

// The test businesses that have a quote in the presentation data. Their PDFs are made here, through the same code
// the panel uses, so what the presentation shows is what the product makes.
const WITH_QUOTE = ["+14075550111", "+14075550117"];

const seedDocuments = async (client: pg.Client): Promise<void> => {
  let deps;
  try {
    const config = loadConfig();
    deps = {
      config,
      db: { query: (text: string, values?: unknown[]) => client.query(text, values), close: async () => {} },
      renderPdf: gotenbergRenderer(config),
    };
  } catch {
    console.log("documents: skipped (the core-api configuration is incomplete; run npm run local:init)");
    return;
  }
  const { rows } = await client.query<{ deal_id: number; has_visit: boolean }>(
    `select d.id as deal_id,
            exists (select 1 from core.appointments a where a.deal_id = d.id and a.status = 'confirmed') as has_visit
     from public.deals d
     join public.contacts c on c.id = d.primary_contact_id
     where d.is_test
       and c.phone_jsonb -> 0 ->> 'number' = any ($1)
       and exists (select 1 from core.quotes q where q.deal_id = d.id)
     order by d.id`,
    [WITH_QUOTE],
  );
  let made = 0;
  try {
    for (const { deal_id, has_visit } of rows) {
      const types = has_visit ? (["quote", "purchase_order", "work_order"] as const) : (["quote"] as const);
      for (const documentType of types) {
        const document = await issueDocument(deps, { dealId: deal_id, documentType, appointmentId: null });
        if (document.created) made += 1;
      }
    }
    console.log(`documents ready: ${made} new PDF documents for ${rows.length} test deals`);
  } catch (error) {
    if (!(error instanceof PdfEngineError)) throw error;
    console.log("documents: the PDF engine is not running, so no PDF was made. Start it (Gotenberg) and run this again, or use the buttons of the deal.");
  }
};

const args = process.argv.slice(2);
const reset = args.includes("--reset");
if (reset && !args.includes("--yes-presentation-db")) {
  console.error("--reset empties contacts, deals, notes, tasks and conversations. Pass --yes-presentation-db to confirm this is the presentation database.");
  process.exit(2);
}
if (process.env.NODE_ENV === "production") {
  console.error("Not for production.");
  process.exit(2);
}

const database = process.env.PGDATABASE ?? "salvionix";
const client = await owner(database);
try {
  await client.query("begin");
  if (reset) {
    await client.query(`
      truncate table
        public.contacts, public.deals, public.companies, public.tasks, public.contact_notes, public.deal_notes,
        core.contact_identities, core.unrouted_events
      restart identity cascade`);
    // The numbers of the test series (PRUEBA-COT, PRUEBA-OC, PRUEBA-OT) start again; the real series is not touched.
    await client.query(`update core.document_counters set last_number = 0 where is_test`);
  }
  const dir = join(DB_DIR, "seeds/presentation");
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
    await client.query(readText(join(dir, file)));
  }
  await client.query("commit");

  const { rows } = await client.query(`
    select (select count(*) from public.contacts)::int as contacts,
           (select count(*) from public.companies)::int as companies,
           (select count(*) from public.deals)::int as deals,
           (select count(*) from public.contact_notes)::int + (select count(*) from public.deal_notes)::int as notes,
           (select count(*) from public.tasks)::int as tasks,
           (select count(*) from core.channels)::int as channels,
           (select count(*) from core.brands)::int as brands`);
  const n = rows[0];
  console.log(`presentation data ready: ${n.contacts} contacts, ${n.companies} companies, ${n.deals} deals, ${n.notes} notes, ${n.tasks} tasks (config kept: ${n.brands} brands, ${n.channels} channels)`);
  await seedDocuments(client);
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
