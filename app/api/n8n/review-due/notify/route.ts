import { NextResponse } from "next/server";
import { getAppPool } from "../../../../../lib/db/appPool.ts";
import { withAuthContext } from "../../../../../lib/db/withAuthContext.ts";
import type { AuthContext } from "../../../../../lib/permissions/authContext.ts";

// POST /api/n8n/review-due/notify
//
// Creates or updates the review_tasks row for a document flagged by
// GET /api/n8n/review-due as 'warning' or 'overdue'. Called by the n8n
// W3 workflow once per document, per scan.
//
// Auth: X-N8N-Secret shared secret (same as W1 / GET review-due).
//
// company_id and owner_id are NOT trusted from the request body — they
// are re-resolved from the DB via w3_resolve_document_for_task
// (migration 0017), the same "never trust client-supplied company_id"
// principle applied to /api/n8n/ingest (which resolves identity via
// auth_find_user_by_email instead of trusting the body). Only
// documentId, reviewDate and classification come from the caller.

interface NotifyBody {
  documentId: string;
  reviewDate: string;
  classification: "warning" | "overdue";
}

function parseBody(body: Record<string, unknown>): NotifyBody | null {
  const documentId = typeof body.documentId === "string" ? body.documentId : null;
  const reviewDate = typeof body.reviewDate === "string" ? body.reviewDate : null;
  const classification = body.classification;
  if (!documentId || !reviewDate) return null;
  if (classification !== "warning" && classification !== "overdue") return null;
  return { documentId, reviewDate, classification };
}

export async function POST(request: Request) {
  const secret = request.headers.get("x-n8n-secret");
  const expectedSecret = process.env.N8N_WEBHOOK_SECRET;
  if (!expectedSecret) {
    console.error("POST /api/n8n/review-due/notify: N8N_WEBHOOK_SECRET is not configured");
    return NextResponse.json({ error: "webhook not configured" }, { status: 503 });
  }
  if (!secret || secret !== expectedSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let rawBody: Record<string, unknown>;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = parseBody(rawBody);
  if (!parsed) {
    return NextResponse.json(
      { error: "documentId, reviewDate and classification ('warning'|'overdue') are required" },
      { status: 400 }
    );
  }

  // Resolve company_id/owner_id/status server-side — never from the body.
  let resolved: { company_id: string; owner_id: string; status: string } | null;
  try {
    const pool = getAppPool();
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        "SELECT * FROM w3_resolve_document_for_task($1)",
        [parsed.documentId]
      );
      resolved = rows[0] ?? null;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("POST /api/n8n/review-due/notify: DB lookup failed", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }

  if (!resolved || resolved.status !== "published") {
    return NextResponse.json({ error: "document not found or not published" }, { status: 404 });
  }

  const ctx: AuthContext = {
    userId: resolved.owner_id,
    companyId: resolved.company_id,
    role: "admin",
    departmentId: null,
  };

  try {
    const task = await withAuthContext(ctx, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO review_tasks (document_id, company_id, owner_id, status, due_date, notified_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (document_id) WHERE status IN ('warning', 'overdue')
         DO UPDATE SET status = EXCLUDED.status, reminded_at = now(), updated_at = now()
         RETURNING id, status, due_date, notified_at, reminded_at`,
        [parsed.documentId, resolved!.company_id, resolved!.owner_id, parsed.classification, parsed.reviewDate]
      );
      return rows[0];
    });

    return NextResponse.json({ ok: true, task });
  } catch (err) {
    console.error("POST /api/n8n/review-due/notify: write failed", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
