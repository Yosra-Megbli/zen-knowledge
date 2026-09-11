import { NextResponse } from "next/server";
import { getAppPool } from "../../../../lib/db/appPool.ts";
import { ingestDocument, type IngestDocumentTarget } from "../../../../lib/ingestion/pipeline/ingestDocument.ts";
import { IngestionError, IngestionForbiddenError, IngestionNotFoundError } from "../../../../lib/ingestion/errors.ts";
import type { AuthContext, Role } from "../../../../lib/permissions/authContext.ts";

// POST /api/n8n/ingest
//
// Webhook entry point for the n8n W1 ingestion workflow.
// Authentication: shared secret in the X-N8N-Secret header
// (N8N_WEBHOOK_SECRET env var). This is NOT a session-cookie route —
// n8n cannot hold an Auth.js session. The secret proves the caller is
// the trusted n8n instance, then the user identity is resolved from
// the DB (same as authorizeCredentials does at login time).
//
// Security invariants preserved:
// - company_id / role / department_id come from the DB lookup, never
//   from the request body.
// - ingestDocument() runs under app_role + RLS (withAuthContext).
// - Never publishes automatically — status stays 'ready' at best.
// - N8N_WEBHOOK_SECRET is never echoed in any response.

export async function POST(request: Request) {
  // ── 1. Authenticate the n8n caller via shared secret ──────────────
  const secret = request.headers.get("x-n8n-secret");
  const expectedSecret = process.env.N8N_WEBHOOK_SECRET;
  if (!expectedSecret) {
    console.error("POST /api/n8n/ingest: N8N_WEBHOOK_SECRET is not configured");
    return NextResponse.json({ error: "webhook not configured" }, { status: 503 });
  }
  if (!secret || secret !== expectedSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ── 2. Parse and validate the request body ─────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const triggerEmail = typeof body.email === "string" ? body.email.trim() : null;
  const fileBase64 = typeof body.fileBase64 === "string" ? body.fileBase64 : null;
  const fileName = typeof body.fileName === "string" ? body.fileName.trim() : null;
  const title = typeof body.title === "string" ? body.title.trim() : null;
  const visibility = body.visibility;

  if (!triggerEmail) return NextResponse.json({ error: "email is required" }, { status: 400 });
  if (!fileBase64) return NextResponse.json({ error: "fileBase64 is required" }, { status: 400 });
  if (!fileName) return NextResponse.json({ error: "fileName is required" }, { status: 400 });
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  if (visibility !== "company" && visibility !== "department" && visibility !== "restricted") {
    return NextResponse.json(
      { error: "visibility must be one of: company, department, restricted" },
      { status: 400 }
    );
  }

  // ── 3. Resolve user identity from DB (app_role, never migration_role)
  // This mirrors what authorizeCredentials() does at login time.
  // company_id / role / department_id come exclusively from the DB —
  // never from the request body.
  let ctx: AuthContext;
  try {
    const pool = getAppPool();
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        "SELECT * FROM auth_find_user_by_email($1)",
        [triggerEmail]
      );
      const user = rows[0];
      if (!user || user.status !== "active") {
        return NextResponse.json({ error: "user not found or inactive" }, { status: 403 });
      }
      if (!user.company_id) {
        return NextResponse.json({ error: "user has no company assigned" }, { status: 403 });
      }
      ctx = {
        userId: user.id,
        companyId: user.company_id,
        role: user.role as Role,
        departmentId: user.department_id ?? null,
      };
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("POST /api/n8n/ingest: DB lookup failed", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }

  // ── 4. Decode the file ─────────────────────────────────────────────
  let data: Buffer;
  try {
    data = Buffer.from(fileBase64, "base64");
  } catch {
    return NextResponse.json({ error: "fileBase64 is not valid base64" }, { status: 400 });
  }
  if (data.length === 0) {
    return NextResponse.json({ error: "file is empty" }, { status: 400 });
  }

  // ── 5. Build target — optional documentId for new version on existing doc
  const documentIdField = typeof body.documentId === "string" ? body.documentId : null;
  const target: IngestDocumentTarget = documentIdField
    ? { kind: "version", documentId: documentIdField }
    : {
        kind: "new",
        title,
        description: typeof body.description === "string" ? body.description : null,
        departmentId: typeof body.departmentId === "string" ? body.departmentId : null,
        visibility,
        reviewDate: typeof body.reviewDate === "string" ? body.reviewDate : null,
      };

  // ── 6. Run the existing ingestion pipeline (unchanged) ─────────────
  // ingestDocument() runs under app_role + RLS via withAuthContext.
  // It NEVER publishes — status ends at 'ready' at best.
  try {
    const result = await ingestDocument({
      ctx,
      fileName,
      data,
      target,
      triggeredBy: `n8n:${triggerEmail}`,
    });

    // Never echo secrets in the response.
    return NextResponse.json(
      {
        ok: result.status === "completed",
        status: result.status,
        documentId: result.documentId,
        documentVersionId: result.documentVersionId,
        ingestionJobId: result.ingestionJobId,
        chunkCount: result.chunkCount,
        // errorCode/errorMessage only present on failure
        ...(result.status === "failed" && {
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
        }),
        // Explicit reminder: document is NOT published.
        published: false,
        note: "Document is in 'ready' status. Explicit publication required via POST /api/documents/[versionId]/publish.",
      },
      { status: result.status === "completed" ? 201 : 422 }
    );
  } catch (err) {
    if (err instanceof IngestionForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof IngestionNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof IngestionError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 422 });
    }
    console.error("POST /api/n8n/ingest: unexpected error", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
