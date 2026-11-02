import { bootstrapRoles, createDatabase, migrate, seedSample } from "../scripts/db-lib.ts";
import { loadLocalEnv, TEST_DB } from "./helpers.ts";

/** Every run starts from an empty database, so the migrations themselves are under test. */
export default async function setup(): Promise<void> {
  loadLocalEnv();
  await bootstrapRoles();
  await createDatabase(TEST_DB, { recreate: true });
  await migrate(TEST_DB);
  await seedSample(TEST_DB);
}
