import { NextResponse } from "next/server";
import { getAppPool } from "../../../../lib/db/appPool.ts";
import { withAuthContext } from "../../../../lib/db/withAuthContext.ts";
import { unpublishDocument } from "../../../../lib/ingestion/pipeline/unpublishDocument.ts";
import { IngestionNotFoundError } from "../../../../lib/ingestion/errors.ts";
import type { AuthContext } from "../../../../lib/permissions/authContext.ts";

// POST /api/n8n/unpublish
//
// Unpublishes a document whose review_date is past the configured
// grace period (classification 'unpublish' from GET
// /api/n8n/review-due). Called by the n8n W3 workflow.
//
// Auth: X-N8N-Secret shared secret (same as W1 / GET review-due).
//
// company_id/owner_id are re-resolved server-side via
// w3_resolve_document_for_task (migration 0017) — never trusted from
// the request body. Only documentId comes from the caller.
//
// This is a real, human-designed enforcement of "Upload != Published"
// in reverse: a document that goes unreviewed past its grace period
// stops being retrievable automatically, without requiring a human to
// remember to act. The open review_tasks row is marked 'unpublished'
// in the same request so it stops showing up in future scans.

export async function POST(request: Request) {
  const secret = request.headers.get("x-n8n-secret");
  const expectedSecret = process.env.N8N_WEBHOOK_SECRET;
  if (!expectedSecret) {
    console.error("POST /api/n8n/unpublish: N8N_WEBHOOK_SECRET is not configured");
    return NextResponse.json({ error: "webhook not configured" }, { status: 503 });
  }
  if (!secret || secret !== expectedSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const documentId = typeof body.documentId === "string" ? body.documentId : null;
  if (!documentId) {
    return NextResponse.json({ error: "documentId is required" }, { status: 400 });
  }

  let resolved: { company_id: string; owner_id: string; status: string } | null;
  try {
    const pool = getAppPool();
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        "SELECT * FROM w3_resolve_document_for_task($1)",
        [documentId]
      );
      resolved = rows[0] ?? null;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("POST /api/n8n/unpublish: DB lookup failed", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }

  if (!resolved || resolved.status !== "published") {
    return NextResponse.json({ error: "document not found or not currently published" }, { status: 404 });
  }

  const ctx: AuthContext = {
    userId: resolved.owner_id,
    companyId: resolved.company_id,
    role: "admin",
    departmentId: null,
  };

  try {
    const { documentVersionId } = await unpublishDocument(ctx, documentId);

    // Best-effort: mark the open review task 'unpublished'. A failure
    // here does not roll back the unpublish itself — the document is
    // already correctly unretrievable, which is the security-relevant
    // outcome. A stale open task would only affect the next scan's
    // cosmetics, not access control.
    try {
      await withAuthContext(ctx, async (client) => {
        await client.query(
          `UPDATE review_tasks SET status = 'unpublished', resolved_at = now(), updated_at = now()
           WHERE document_id = $1 AND status IN ('warning', 'overdue')`,
          [documentId]
        );
      });
    } catch (err) {
      console.error("POST /api/n8n/unpublish: review_tasks cleanup failed (non-fatal)", err);
    }

    return NextResponse.json({ ok: true, documentId, documentVersionId, status: "unpublished" });
  } catch (err) {
    if (err instanceof IngestionNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error("POST /api/n8n/unpublish: unexpected error", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
