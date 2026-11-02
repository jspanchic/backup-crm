import { seedSample } from "./db-lib.ts";

await seedSample(process.env.PGDATABASE ?? "salvionix");
console.log("sample data loaded");
