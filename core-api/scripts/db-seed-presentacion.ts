// Loads the presentation data (fictitious, every row is_test). With --reset it first empties what customers
// and the bot create, so the show starts clean. Configuration (brands, channels, prices, technicians) stays.
// Only for the presentation database: it refuses to run without --yes-presentation-db.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { DB_DIR, owner, readText } from "./db-lib.ts";

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
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
