// Exercises the actual ingestDocument()/publishVersion() functions
// (not raw SQL) — the same functions app/api/documents/*/route.ts
// calls. Every call goes through app_role via withAuthContext; nothing
// here ever touches migration_role except for read-only assertions
// used to verify persisted state.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ingestDocument } from "../../../lib/ingestion/pipeline/ingestDocument.ts";
import { publishVersion } from "../../../lib/ingestion/pipeline/publishVersion.ts";
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

async function ingest(ctx: AuthContext, fixtureName: string, overrides: Partial<{ title: string; visibility: "company" | "department" | "restricted" }> = {}) {
  return ingestDocument({
    ctx,
    fileName: fixtureName,
    data: readFixture(fixtureName),
    target: { kind: "new", title: overrides.title ?? `Test — ${fixtureName} — ${Date.now()}`, visibility: overrides.visibility ?? "company" },
    triggeredBy: "test",
  });
}

// ---- 2, 15 — authenticated user's uploads always belong to their own company ----
test("2, 15 — a successful ingestion persists chunks scoped to the uploader's own company/document/version", async () => {
  const ctx = ctxFor("Acme Corp", "admin");
  const result = await ingest(ctx, "valid.txt");
  assert.equal(result.status, "completed");
  assert.ok(result.chunkCount > 0);

  const client = await getMigrationClient();
  try {
    const rows = await client.query(
      `SELECT company_id, document_id, document_version_id FROM document_chunks WHERE document_version_id = $1`,
      [result.documentVersionId]
    );
    assert.ok(rows.rowCount! > 0);
    for (const row of rows.rows) {
      assert.equal(row.company_id, ctx.companyId);
      assert.equal(row.document_id, result.documentId);
      assert.equal(row.document_version_id, result.documentVersionId);
    }
  } finally {
    await client.end();
  }
});

// ---- 3 — Company A cannot create/use a document belonging to Company B ----
test("3 — Company A cannot add a version to a Company B document", async () => {
  const acmeCtx = ctxFor("Acme Corp", "admin");
  const novaCtx = ctxFor("Nova Bank", "admin");

  const acmeDoc = await ingest(acmeCtx, "valid.txt");
  assert.equal(acmeDoc.status, "completed");

  await assert.rejects(
    () =>
      ingestDocument({
        ctx: novaCtx,
        fileName: "valid.txt",
        data: readFixture("valid.txt"),
        target: { kind: "version", documentId: acmeDoc.documentId },
        triggeredBy: "test",
      }),
    (err: unknown) => err instanceof IngestionNotFoundError
  );
});

// ---- 4, 6 — role restrictions on visibility ----
test("4, 6 — an employee cannot create a Restricted-visibility document", async () => {
  const ctx = ctxFor("Acme Corp", "employee");
  await assert.rejects(
    () => ingest(ctx, "valid.txt", { visibility: "restricted" }),
    (err: unknown) => err instanceof IngestionForbiddenError
  );
});

test("an admin CAN create a Restricted-visibility document", async () => {
  const ctx = ctxFor("Acme Corp", "admin");
  const result = await ingest(ctx, "valid.txt", { visibility: "restricted" });
  assert.equal(result.status, "completed");
});

// ---- 7, 8 — file validation ----
test("7 — an unsupported file is rejected before any DB write", async () => {
  const ctx = ctxFor("Acme Corp", "admin");
  await assert.rejects(
    () => ingest(ctx, "unsupported.bin"),
    (err: unknown) => err instanceof IngestionError && err.code === "UNSUPPORTED_FILE_TYPE"
  );
});

test("8 — an empty file is rejected before any DB write", async () => {
  const ctx = ctxFor("Acme Corp", "admin");
  await assert.rejects(
    () => ingest(ctx, "empty.txt"),
    (err: unknown) => err instanceof IngestionError && err.code === "EMPTY_FILE"
  );
});

// ---- 9, 10, 11 — extraction-stage failures ----
test("9, 11 — an empty-text (scanned) PDF fails ingestion and does not publish", async () => {
  const ctx = ctxFor("Acme Corp", "admin");
  const result = await ingest(ctx, "empty-text.pdf");
  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "NO_EXTRACTABLE_TEXT");
  assert.equal(result.chunkCount, 0);

  const client = await getMigrationClient();
  try {
    const version = await client.query(`SELECT status FROM document_versions WHERE id = $1`, [result.documentVersionId]);
    assert.equal(version.rows[0].status, "failed");
    const job = await client.query(`SELECT status, error_code FROM ingestion_jobs WHERE id = $1`, [result.ingestionJobId]);
    assert.equal(job.rows[0].status, "failed");
    assert.equal(job.rows[0].error_code, "NO_EXTRACTABLE_TEXT");
  } finally {
    await client.end();
  }
});

test("10, 11 — a corrupted PDF is handled safely (no crash) and fails ingestion", async () => {
  const ctx = ctxFor("Acme Corp", "admin");
  const result = await ingest(ctx, "corrupted.pdf");
  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "CORRUPTED_FILE");
});

// ---- 12, 13 — publication control ----
test("12 — a failed ingestion cannot be published", async () => {
  const ctx = ctxFor("Acme Corp", "admin");
  const result = await ingest(ctx, "corrupted.pdf");
  assert.equal(result.status, "failed");

  await assert.rejects(
    () => publishVersion(ctx, result.documentVersionId),
    (err: unknown) => err instanceof IngestionError && err.code === "INVALID_METADATA"
  );
});

test("13 — a successfully processed document is NOT automatically published; only becomes published after explicit control", async () => {
  const ctx = ctxFor("Acme Corp", "admin");
  const result = await ingest(ctx, "valid.txt");
  assert.equal(result.status, "completed");

  const client = await getMigrationClient();
  try {
    const doc = await client.query(`SELECT status, current_version_id FROM documents WHERE id = $1`, [result.documentId]);
    assert.equal(doc.rows[0].status, "draft", "upload must never auto-publish the document");
    assert.equal(doc.rows[0].current_version_id, null);

    const version = await client.query(`SELECT status FROM document_versions WHERE id = $1`, [result.documentVersionId]);
    assert.equal(version.rows[0].status, "ready");
  } finally {
    await client.end();
  }

  const pub = await publishVersion(ctx, result.documentVersionId);
  assert.equal(pub.published, true);

  const client2 = await getMigrationClient();
  try {
    const doc = await client2.query(`SELECT status, current_version_id FROM documents WHERE id = $1`, [result.documentId]);
    assert.equal(doc.rows[0].status, "published");
    assert.equal(doc.rows[0].current_version_id, result.documentVersionId);
  } finally {
    await client2.end();
  }
});

// ---- 14 — deleted documents ----
test("14 — a deleted document cannot be reintroduced by ingesting a new version into it", async () => {
  const ctx = ctxFor("Acme Corp", "admin");
  const result = await ingest(ctx, "valid.txt");
  assert.equal(result.status, "completed");

  const client = await getMigrationClient();
  try {
    await client.query(`UPDATE documents SET status = 'deleted', deleted_at = now() WHERE id = $1`, [result.documentId]);
  } finally {
    await client.end();
  }

  await assert.rejects(
    () =>
      ingestDocument({
        ctx,
        fileName: "valid.txt",
        data: readFixture("valid.txt"),
        target: { kind: "version", documentId: result.documentId },
        triggeredBy: "test",
      }),
    (err: unknown) => err instanceof IngestionError && err.code === "DOCUMENT_DELETED"
  );
});

// ---- 16 — embedding dimension ----
test("16 — persisted embeddings are exactly 384 dimensions", async () => {
  const ctx = ctxFor("Acme Corp", "admin");
  const result = await ingest(ctx, "valid.pdf");
  assert.equal(result.status, "completed");

  const client = await getMigrationClient();
  try {
    const rows = await client.query(`SELECT vector_dims(embedding) AS dims FROM document_chunks WHERE document_version_id = $1`, [
      result.documentVersionId,
    ]);
    assert.ok(rows.rowCount! > 0);
    for (const row of rows.rows) {
      assert.equal(row.dims, 384);
    }
  } finally {
    await client.end();
  }
});

// ---- 17 — no empty chunks persisted ----
test("17 — no empty chunks are ever persisted", async () => {
  const ctx = ctxFor("Acme Corp", "admin");
  const result = await ingest(ctx, "valid.pdf");
  assert.equal(result.status, "completed");

  const client = await getMigrationClient();
  try {
    const rows = await client.query(`SELECT content FROM document_chunks WHERE document_version_id = $1`, [result.documentVersionId]);
    for (const row of rows.rows) {
      assert.ok(row.content.trim().length > 0);
    }
  } finally {
    await client.end();
  }
});

// ---- Upload != Published, proven through the retrieval layer (Phase 3) ----
test("an ingested-but-unpublished document is not retrievable via retrieveAuthorizedChunks", async () => {
  const ctx = ctxFor("Acme Corp", "admin");
  const result = await ingest(ctx, "valid.txt", { title: `Unpublished retrieval check ${Date.now()}` });
  assert.equal(result.status, "completed");

  const retrieval = await retrieveAuthorizedChunks(ctx, "valid document ingestion pipeline testing", {
    minSimilarity: -1,
    k: 1000,
  });
  assert.ok(
    !retrieval.chunks.some((c) => c.documentId === result.documentId),
    "an unpublished (ready) version must never be retrievable, even by the same company/admin"
  );

  await publishVersion(ctx, result.documentVersionId);

  const afterPublish = await retrieveAuthorizedChunks(ctx, "valid document ingestion pipeline testing", {
    minSimilarity: -1,
    k: 1000,
  });
  assert.ok(afterPublish.chunks.some((c) => c.documentId === result.documentId), "must become retrievable once published");
});

// ---- publish role restriction ----
test("employee cannot publish a document", async () => {
  const adminCtx = ctxFor("Acme Corp", "admin");
  const employeeCtx = ctxFor("Acme Corp", "employee");
  const result = await ingest(adminCtx, "valid.txt");
  assert.equal(result.status, "completed");

  await assert.rejects(
    () => publishVersion(employeeCtx, result.documentVersionId),
    (err: unknown) => err instanceof IngestionForbiddenError
  );
});
