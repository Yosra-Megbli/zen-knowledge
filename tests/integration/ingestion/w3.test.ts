// Exercises the W3 (obsolescence) building blocks: unpublishDocument()
// (the pipeline function behind POST /api/n8n/unpublish), the
// w3_resolve_document_for_task SECURITY DEFINER lookup used by both
// write-side n8n routes to avoid trusting a client-supplied company_id
// (migration 0017), and the review_tasks upsert used by POST
// /api/n8n/review-due/notify (migration 0015's partial unique index —
// one open task per document).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ingestDocument } from "../../../lib/ingestion/pipeline/ingestDocument.ts";
import { publishVersion } from "../../../lib/ingestion/pipeline/publishVersion.ts";
import { unpublishDocument } from "../../../lib/ingestion/pipeline/unpublishDocument.ts";
import { IngestionNotFoundError } from "../../../lib/ingestion/errors.ts";
import { retrieveAuthorizedChunks } from "../../../lib/rag/retrieveAuthorizedChunks.ts";
import { withAuthContext } from "../../../lib/db/withAuthContext.ts";
import { getAppPool } from "../../../lib/db/appPool.ts";
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

async function ingestAndPublish(ctx: AuthContext, title: string) {
  const result = await ingestDocument({
    ctx,
    fileName: "valid.txt",
    data: readFixture("valid.txt"),
    target: { kind: "new", title, visibility: "company" },
    triggeredBy: "test",
  });
  assert.equal(result.status, "completed");
  await publishVersion(ctx, result.documentVersionId);
  return result;
}

async function resolveForTask(documentId: string) {
  const pool = getAppPool();
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      "SELECT * FROM w3_resolve_document_for_task($1)",
      [documentId]
    );
    return rows[0] ?? null;
  } finally {
    client.release();
  }
}

test("unpublishDocument reverses a publish: document -> unpublished, version -> archived, chunks unretrievable", async () => {
  const ctx = ctxFor("Acme Corp", "admin");
  const result = await ingestAndPublish(ctx, `W3 unpublish check ${Date.now()}`);

  const before = await retrieveAuthorizedChunks(ctx, "valid document ingestion pipeline testing", {
    minSimilarity: -1,
    k: 1000,
  });
  assert.ok(before.chunks.some((c) => c.documentId === result.documentId), "must be retrievable once published");

  const { documentVersionId } = await unpublishDocument(ctx, result.documentId);
  assert.equal(documentVersionId, result.documentVersionId);

  const client = await getMigrationClient();
  try {
    const doc = await client.query(`SELECT status FROM documents WHERE id = $1`, [result.documentId]);
    assert.equal(doc.rows[0].status, "unpublished");
    const version = await client.query(`SELECT status FROM document_versions WHERE id = $1`, [result.documentVersionId]);
    assert.equal(version.rows[0].status, "archived");
  } finally {
    await client.end();
  }

  const after = await retrieveAuthorizedChunks(ctx, "valid document ingestion pipeline testing", {
    minSimilarity: -1,
    k: 1000,
  });
  assert.ok(
    !after.chunks.some((c) => c.documentId === result.documentId),
    "must no longer be retrievable once unpublished"
  );
});

test("unpublishDocument rejects a document that is not currently published", async () => {
  const ctx = ctxFor("Acme Corp", "admin");
  const result = await ingestDocument({
    ctx,
    fileName: "valid.txt",
    data: readFixture("valid.txt"),
    target: { kind: "new", title: `W3 draft, never published ${Date.now()}`, visibility: "company" },
    triggeredBy: "test",
  });
  assert.equal(result.status, "completed");

  await assert.rejects(
    () => unpublishDocument(ctx, result.documentId),
    (err: unknown) => err instanceof IngestionNotFoundError
  );
});

test("unpublishDocument does not require the acting role to be admin (service trust boundary, not a user session)", async () => {
  const adminCtx = ctxFor("Acme Corp", "admin");
  const employeeCtx = ctxFor("Acme Corp", "employee");
  const result = await ingestAndPublish(adminCtx, `W3 employee-owner unpublish ${Date.now()}`);

  // unpublishDocument itself does not gate on role — POST /api/n8n/unpublish
  // is reached only via the N8N_WEBHOOK_SECRET boundary, a service-to-service
  // trust boundary distinct from publishVersion()'s employee-forbidden check
  // (which protects a user-initiated request). Using an employee ctx here
  // still respects company-scoped RLS (same company), proving the function
  // does not silently no-op for a non-admin acting context.
  const { documentVersionId } = await unpublishDocument(employeeCtx, result.documentId);
  assert.equal(documentVersionId, result.documentVersionId);
});

test("w3_resolve_document_for_task returns the real company_id/owner_id/status, and nothing for an unknown id", async () => {
  const ctx = ctxFor("Acme Corp", "admin");
  const result = await ingestAndPublish(ctx, `W3 resolve check ${Date.now()}`);

  const resolved = await resolveForTask(result.documentId);
  assert.ok(resolved);
  assert.equal(resolved.company_id, ctx.companyId);
  assert.equal(resolved.status, "published");

  const missing = await resolveForTask("00000000-0000-0000-0000-000000000000");
  assert.equal(missing, null);
});

test("review_tasks notify upsert: one open task per document, classification/reminded_at update in place instead of duplicating", async () => {
  const ctx = ctxFor("Acme Corp", "admin");
  const result = await ingestAndPublish(ctx, `W3 notify upsert ${Date.now()}`);
  const resolved = await resolveForTask(result.documentId);
  assert.ok(resolved);

  const notifyCtx: AuthContext = { userId: resolved.owner_id, companyId: resolved.company_id, role: "admin", departmentId: null };

  const first = await withAuthContext(notifyCtx, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO review_tasks (document_id, company_id, owner_id, status, due_date, notified_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (document_id) WHERE status IN ('warning', 'overdue')
       DO UPDATE SET status = EXCLUDED.status, reminded_at = now(), updated_at = now()
       RETURNING id, status, notified_at, reminded_at`,
      [result.documentId, resolved.company_id, resolved.owner_id, "warning", "2020-01-01"]
    );
    return rows[0];
  });
  assert.equal(first.status, "warning");
  assert.ok(first.notified_at);
  assert.equal(first.reminded_at, null);

  const second = await withAuthContext(notifyCtx, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO review_tasks (document_id, company_id, owner_id, status, due_date, notified_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (document_id) WHERE status IN ('warning', 'overdue')
       DO UPDATE SET status = EXCLUDED.status, reminded_at = now(), updated_at = now()
       RETURNING id, status, notified_at, reminded_at`,
      [result.documentId, resolved.company_id, resolved.owner_id, "overdue", "2020-01-01"]
    );
    return rows[0];
  });

  assert.equal(second.id, first.id, "must update the same row, not insert a duplicate");
  assert.equal(second.status, "overdue");
  assert.ok(second.reminded_at, "reminded_at must be set on the second (reminder) notification");

  const client = await getMigrationClient();
  try {
    const rows = await client.query(`SELECT count(*)::int AS n FROM review_tasks WHERE document_id = $1`, [result.documentId]);
    assert.equal(rows.rows[0].n, 1, "exactly one review_tasks row must exist for this document");
  } finally {
    await client.end();
  }
});
