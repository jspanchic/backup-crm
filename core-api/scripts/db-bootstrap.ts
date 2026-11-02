import { bootstrapRoles, createDatabase } from "./db-lib.ts";

await bootstrapRoles();
await createDatabase(process.env.PGDATABASE ?? "salvionix");
console.log("roles and database ready");
