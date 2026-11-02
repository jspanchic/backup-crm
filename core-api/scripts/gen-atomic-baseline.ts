import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderBaseline } from "./atomic-baseline.ts";
import { DB_DIR } from "./db-lib.ts";

writeFileSync(join(DB_DIR, "migrations/0002_atomic_baseline.sql"), renderBaseline());
console.log("db/migrations/0002_atomic_baseline.sql written");
