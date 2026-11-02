import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { atomicSource, renderBaseline } from "../../scripts/atomic-baseline.ts";
import { DB_DIR, migrate, migrationFiles, readText, REPO_ROOT, sha256 } from "../../scripts/db-lib.ts";
import { ownerClient, TEST_DB } from "../helpers.ts";

describe("migrations", () => {
  it("does nothing on a second run", async () => {
    await expect(migrate(TEST_DB)).resolves.toEqual([]);
  });

  it("records every file with its checksum", async () => {
    const db = await ownerClient();
    try {
      const { rows } = await db.query("select filename, checksum from core.schema_migrations order by filename");
      expect(rows.map((row) => row.filename)).toEqual(migrationFiles());
      for (const row of rows) {
        expect(row.checksum).toBe(sha256(readText(join(DB_DIR, "migrations", row.filename))));
      }
    } finally {
      await db.end();
    }
  });

  it("refuses to run when an applied migration was edited", async () => {
    const db = await ownerClient();
    const file = "0008_api_functions.sql";
    try {
      await db.query("update core.schema_migrations set checksum = 'edited' where filename = $1", [file]);
      await expect(migrate(TEST_DB)).rejects.toThrow(`Applied migration ${file} was edited`);
    } finally {
      await db.query("update core.schema_migrations set checksum = $1 where filename = $2", [
        sha256(readText(join(DB_DIR, "migrations", file))),
        file,
      ]);
      await db.end();
    }
  });

  describe("following the upstream", () => {
    it("has a decision for every Atomic migration: a new one must be listed in the lock", () => {
      const present = readdirSync(join(REPO_ROOT, "backoffice/supabase/migrations"))
        .filter((file) => file.endsWith(".sql"))
        .sort();
      const locked = readText(join(DB_DIR, "upstream-migrations.lock")).trim().split("\n").sort();
      expect(present).toEqual(locked);
    });

    it("has a baseline generated from the current Atomic schema", () => {
      const baseline = readText(join(DB_DIR, "migrations/0002_atomic_baseline.sql"));
      expect(baseline).toContain(`-- source-sha256: ${sha256(atomicSource())}`);
      expect(baseline).toBe(renderBaseline());
    });

    it("does not need the http extension", () => {
      expect(readText(join(DB_DIR, "migrations/0002_atomic_baseline.sql"))).not.toContain('extension if not exists "http"');
    });
  });

  it("loads the sample configuration flagged as not confirmed", async () => {
    const db = await ownerClient();
    try {
      const { rows } = await db.query(
        `select
           (select is_confirmed from core.price_lists where version = 1 and brand_id = 1) as prices,
           (select is_confirmed from core.scheduling_settings where brand_id = 1) as schedule`,
      );
      expect(rows[0]).toEqual({ prices: false, schedule: false });
    } finally {
      await db.end();
    }
  });
});
