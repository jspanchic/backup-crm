import { migrate } from "./db-lib.ts";

const applied = await migrate(process.env.PGDATABASE ?? "salvionix");
console.log(applied.length ? `applied:\n  ${applied.join("\n  ")}` : "nothing to apply");
