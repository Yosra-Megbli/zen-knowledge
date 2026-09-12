// Exercises the actual deleteDocument() pipeline function (the same
// one app/api/documents/[versionId]/delete/route.ts calls) — proves
// the soft-delete propagation trigger (db/migrations/0008/0013) and
// role gating, not just that the SQL exists.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ingestDocument } from "../../../lib/ingestion/pipeline/ingestDocument.ts";
import { publishVersion } from "../../../lib/ingestion/pipeline/publishVersion.ts";
import { deleteDocument } from "../../../lib/ingestion/pipeline/deleteDocument.ts";
import { IngestionError, IngestionForbiddenError, IngestionNotFoundError } from "../../../lib/ingestion/errors.ts";
import { retrieveAuthorizedChunks } from "../../../lib/rag/retrieveAuthorizedChunks.ts";
import { getMigrationClient } from "../../../db/db.mjs";
import { fixtures } from "../rls/helpers.mjs";
import type { AuthContext } from "../../../lib/permissions/authContext.ts";

const f = await fixtures();
const FIXTURES_DIR = path.join(process.cwd(), "tests/fixtures/ingestion");

function readFixture(name: string): Buffer {
  return readFileSync(path.join(FIXTURES_DIR, name));
}

function ctxFor(company: "Acme Corp" | "Nova Bank", role: "admin" | "contributor" | "employee"): AuthContext {
  const user = f.users[`${company}:${role}`];
  return { userId: user.id, companyId: f.companies[company], role, departmentId: user.department_id };
}

async function ingestAndPublish(ctx: AuthContext, fixtureName: string) {
  const result = await ingestDocument({
    ctx,
    fileName: fixtureName,
    data: readFixture(fixtureName),
    target: { kind: "new", title: `Test delete — ${fixtureName} — ${Date.now()}-${Math.random()}`, visibility: "company" },
    triggeredBy: "test",
  });
  assert.equal(result.status, "completed");
  await publishVersion(ctx, result.documentVersionId);
  return result;
}

test("deleteDocument sets documents.status = 'deleted'", async () => {
  const ctx = ctxFor("Acme Corp", "admin");
  const doc = await ingestAndPublish(ctx, "valid.txt");

  const before = await deleteDocument(ctx, doc.documentId);
  assert.deepEqual(before, { deleted: true });

  const client = await getMigrationClient();
  try {
    const res = await client.query(`SELECT status, deleted_at FROM documents WHERE id = $1`, [doc.documentId]);
    assert.equal(res.rows[0].status, "deleted");
    assert.ok(res.rows[0].deleted_at);
  } finally {
    await client.end();
  }
});

test("the propagation trigger cascades document_status = 'deleted' onto every chunk", async () => {
  const ctx = ctxFor("Acme Corp", "admin");
  const doc = await ingestAndPublish(ctx, "valid.txt");
  await deleteDocument(ctx, doc.documentId);

  const client = await getMigrationClient();
  try {
    const res = await client.query(
      `SELECT DISTINCT document_status FROM document_chunks WHERE document_id = $1`,
      [doc.documentId]
    );
    assert.ok(res.rowCount! > 0, "expected chunks to still exist (soft delete, not hard delete)");
    for (const row of res.rows) assert.equal(row.document_status, "deleted");
  } finally {
    await client.end();
  }
});

test("a deleted document's chunks are no longer returned by retrieval", async () => {
  const ctx = ctxFor("Acme Corp", "admin");
  const doc = await ingestAndPublish(ctx, "valid.txt");
  // Query near-identical to the fixture's own content (see valid.txt)
  // and a generous k, so this specific chunk ranks in the returned
  // set regardless of how many other chunks earlier test runs have
  // accumulated in this shared local test database.
  const query = "small valid text document used by ingestion tests";

  const before = await retrieveAuthorizedChunks(ctx, query, { minSimilarity: 0, k: 50 });
  assert.ok(before.chunks.some((c) => c.documentId === doc.documentId), "sanity check: chunk was retrievable before delete");

  await deleteDocument(ctx, doc.documentId);

  const after = await retrieveAuthorizedChunks(ctx, query, { minSimilarity: 0, k: 50 });
  assert.ok(!after.chunks.some((c) => c.documentId === doc.documentId), "chunk must be invisible to retrieval after delete");
});

test("an employee cannot delete a document", async () => {
  const admin = ctxFor("Acme Corp", "admin");
  const employee = ctxFor("Acme Corp", "employee");
  const doc = await ingestAndPublish(admin, "valid.txt");

  await assert.rejects(
    () => deleteDocument(employee, doc.documentId),
    (err: unknown) => err instanceof IngestionForbiddenError
  );
});

test("deleting an already-deleted document is rejected, not silently accepted", async () => {
  const ctx = ctxFor("Acme Corp", "admin");
  const doc = await ingestAndPublish(ctx, "valid.txt");
  await deleteDocument(ctx, doc.documentId);

  await assert.rejects(
    () => deleteDocument(ctx, doc.documentId),
    (err: unknown) => err instanceof IngestionError && err.code === "DOCUMENT_DELETED"
  );
});

test("Company B cannot delete Company A's document (not found, not forbidden — RLS makes them indistinguishable)", async () => {
  const acmeCtx = ctxFor("Acme Corp", "admin");
  const novaCtx = ctxFor("Nova Bank", "admin");
  const doc = await ingestAndPublish(acmeCtx, "valid.txt");

  await assert.rejects(
    () => deleteDocument(novaCtx, doc.documentId),
    (err: unknown) => err instanceof IngestionNotFoundError
  );
});
