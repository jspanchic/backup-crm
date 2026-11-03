import { readdirSync } from "node:fs";
import { join } from "node:path";
import { DB_DIR, owner, readText } from "./db-lib.ts";

const database = process.env.PGDATABASE ?? "salvionix";
const client = await owner(database);
try {
  const dir = join(DB_DIR, "seeds/demo");
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
    await client.query(readText(join(dir, file)));
  }
  console.log("demo data loaded (fictitious)");
} finally {
  await client.end();
}
