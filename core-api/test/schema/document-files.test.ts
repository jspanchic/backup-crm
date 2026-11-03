import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { coreApiClient, createLead, createQuote, ownerClient } from "../helpers.ts";

const SHA = "a".repeat(64);

describe("document files", () => {
  let owner: pg.Client;
  let api: pg.Client;
  beforeAll(async () => {
    owner = await ownerClient();
    api = await coreApiClient();
  });
  afterAll(async () => {
    await owner.end();
    await api.end();
  });

  const issued = async () => {
    const lead = await createLead(owner);
    await createQuote(owner, lead.dealId);
    const { rows } = await api.query("select api.issue_document($1, 'quote') as result", [lead.dealId]);
    return rows[0].result as { id: number; display_number: string; created: boolean };
  };

  it("records a file and gives back the latest one", async () => {
    const document = await issued();
    await api.query("select api.record_document_file($1, 'quote', '1', $2, 10)", [document.id, SHA]);
    await api.query("select api.record_document_file($1, 'quote', '2', $2, 20)", [document.id, "b".repeat(64)]);

    const { rows } = await api.query("select api.document_file($1) as result", [document.id]);

    expect(rows[0].result).toMatchObject({ sha256: "b".repeat(64), size_bytes: 20, template_version: "2", display_number: document.display_number });
  });

  it("never changes or deletes a stored file", async () => {
    const document = await issued();
    await api.query("select api.record_document_file($1, 'quote', '1', $2, 10)", [document.id, SHA]);

    await expect(owner.query("update core.document_files set sha256 = $1 where document_id = $2", ["c".repeat(64), document.id])).rejects.toMatchObject({ code: "CX001" });
    await expect(owner.query("delete from core.document_files where document_id = $1", [document.id])).rejects.toMatchObject({ code: "CX001" });
  });

  it("refuses a hash that is not a SHA-256 and an empty file", async () => {
    const document = await issued();

    await expect(api.query("select api.record_document_file($1, 'quote', '1', 'xyz', 10)", [document.id])).rejects.toMatchObject({ code: "23514" });
    await expect(api.query("select api.record_document_file($1, 'quote', '1', $2, 0)", [document.id, SHA])).rejects.toMatchObject({ code: "23514" });
  });

  it("does not let core-api read or write the table directly", async () => {
    await expect(api.query("select * from core.document_files")).rejects.toMatchObject({ code: "42501" });
    await expect(
      api.query("insert into core.document_files (document_id, template_name, template_version, sha256, size_bytes) values (1, 'q', '1', $1, 1)", [SHA]),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("issues once per quote: asking again returns the same number", async () => {
    const lead = await createLead(owner);
    await createQuote(owner, lead.dealId);

    const first = (await api.query("select api.issue_document($1, 'quote') as result", [lead.dealId])).rows[0].result;
    const second = (await api.query("select api.issue_document($1, 'quote') as result", [lead.dealId])).rows[0].result;

    expect(first.created).toBe(true);
    expect(second).toMatchObject({ id: first.id, display_number: first.display_number, created: false });
  });

  it("issues one document when two requests arrive together", async () => {
    const lead = await createLead(owner);
    await createQuote(owner, lead.dealId);
    const other = await coreApiClient();
    try {
      const [a, b] = await Promise.all([
        api.query("select api.issue_document($1, 'quote') as result", [lead.dealId]),
        other.query("select api.issue_document($1, 'quote') as result", [lead.dealId]),
      ]);

      expect(a.rows[0].result.id).toBe(b.rows[0].result.id);
      expect([a.rows[0].result.created, b.rows[0].result.created].filter(Boolean)).toHaveLength(1);
    } finally {
      await other.end();
    }
  });

  it("does not queue a voided document", async () => {
    const document = await issued();
    const file = (await api.query("select api.record_document_file($1, 'quote', '1', $2, 10) as id", [document.id, SHA])).rows[0].id;
    await owner.query("update core.documents set status = 'voided', voided_at = now(), void_reason = 'wrong' where id = $1", [document.id]);

    await expect(api.query("select api.enqueue_document($1, $2, 'hola')", [document.id, file])).rejects.toMatchObject({ code: "CX002" });
  });

  it("does not queue a file of another document", async () => {
    const one = await issued();
    const two = await issued();
    const file = (await api.query("select api.record_document_file($1, 'quote', '1', $2, 10) as id", [one.id, SHA])).rows[0].id;

    await expect(api.query("select api.enqueue_document($1, $2, 'hola')", [two.id, file])).rejects.toMatchObject({ code: "CX004" });
  });
});
