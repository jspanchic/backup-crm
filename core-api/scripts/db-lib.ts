import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";

export const REPO_ROOT = resolve(import.meta.dirname, "../..");
export const DB_DIR = join(REPO_ROOT, "db");
const HOST = process.env.PGHOST ?? "127.0.0.1";
const PORT = Number(process.env.PGPORT ?? 55432);

export const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
};

export const connect = async (user: string, password: string, database: string): Promise<pg.Client> => {
  const client = new pg.Client({ host: HOST, port: PORT, user, password, database });
  await client.connect();
  return client;
};

export const superuser = (database: string) => connect("postgres", requireEnv("PG_SUPERUSER_PASSWORD"), database);
export const owner = (database: string) => connect("core_owner", requireEnv("CORE_OWNER_PASSWORD"), database);

/** git may check SQL out with CRLF on Windows; checksums must not depend on that. */
export const readText = (path: string): string => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Creates the roles and sets their passwords. Safe to re-run. Runs as superuser. */
export const bootstrapRoles = async (): Promise<void> => {
  const client = await superuser("postgres");
  try {
    await client.query(readText(join(DB_DIR, "bootstrap/00_roles.sql")));
    const passwords = {
      core_owner: requireEnv("CORE_OWNER_PASSWORD"),
      core_api: requireEnv("CORE_API_PASSWORD"),
      authenticator: requireEnv("AUTHENTICATOR_PASSWORD"),
    };
    for (const [role, password] of Object.entries(passwords)) {
      await client.query(`alter role ${client.escapeIdentifier(role)} password ${client.escapeLiteral(password)}`);
    }
  } finally {
    await client.end();
  }
};

export const createDatabase = async (name: string, { recreate = false } = {}): Promise<void> => {
  const client = await superuser("postgres");
  try {
    const id = client.escapeIdentifier(name);
    if (recreate) await client.query(`drop database if exists ${id} with (force)`);
    const { rowCount } = await client.query("select 1 from pg_database where datname = $1", [name]);
    if (!rowCount) await client.query(`create database ${id} owner core_owner`);
  } finally {
    await client.end();
  }
};

export const migrationFiles = (): string[] =>
  readdirSync(join(DB_DIR, "migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort();

/**
 * Applies pending migrations in order, each in its own transaction, as core_owner.
 * An applied file must never change: a different checksum stops the run.
 */
export const migrate = async (database: string): Promise<string[]> => {
  const client = await owner(database);
  const applied: string[] = [];
  try {
    await client.query("select pg_advisory_lock(hashtext('salvionix_migrate'))");
    await client.query("create schema if not exists core");
    await client.query(`
      create table if not exists core.schema_migrations (
        filename text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )`);
    const { rows } = await client.query<{ filename: string; checksum: string }>(
      "select filename, checksum from core.schema_migrations",
    );
    const done = new Map(rows.map((row) => [row.filename, row.checksum]));

    for (const file of migrationFiles()) {
      const sql = readText(join(DB_DIR, "migrations", file));
      const checksum = sha256(sql);
      const previous = done.get(file);
      if (previous) {
        if (previous !== checksum) throw new Error(`Applied migration ${file} was edited`);
        continue;
      }
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into core.schema_migrations (filename, checksum) values ($1, $2)", [file, checksum]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
      }
      applied.push(file);
    }
    // PostgREST keeps the shape of the schema in memory: without this a new view answers 404 until it restarts.
    if (applied.length) await client.query("select pg_notify('pgrst', 'reload schema')");
    return applied;
  } finally {
    await client.end();
  }
};

export const seedSample = async (database: string): Promise<void> => {
  const client = await owner(database);
  try {
    const dir = join(DB_DIR, "seeds/sample");
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
      await client.query(readText(join(dir, file)));
    }
  } finally {
    await client.end();
  }
};
