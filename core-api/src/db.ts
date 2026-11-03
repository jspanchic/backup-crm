import pg from "pg";
import type { Config } from "./config.ts";

export type Db = {
  query: <R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]) => Promise<pg.QueryResult<R>>;
  close: () => Promise<void>;
};

/** Connects as core_api: it can run functions in schema api and nothing else. */
export const createDb = (config: Config): Db => {
  const pool = new pg.Pool({
    host: config.PGHOST,
    port: config.PGPORT,
    database: config.PGDATABASE,
    user: "core_api",
    password: config.CORE_API_PASSWORD,
    max: 10,
    statement_timeout: 15_000,
  });
  // An idle client error must not take the process down.
  pool.on("error", () => {});
  return {
    query: (text, values) => pool.query(text, values),
    close: () => pool.end(),
  };
};
