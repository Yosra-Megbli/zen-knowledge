import { NextResponse } from "next/server";
import { getAuthContext } from "../../../../../lib/permissions/authContext.ts";
import { withAuthContext } from "../../../../../lib/db/withAuthContext.ts";
import { deleteDocument } from "../../../../../lib/ingestion/pipeline/deleteDocument.ts";
import { IngestionError, IngestionForbiddenError, IngestionNotFoundError } from "../../../../../lib/ingestion/errors.ts";

// POST /api/documents/[versionId]/delete
//
// Deletion is a DOCUMENT-level action (every version goes with it),
// but this route is keyed by versionId — same as publish/file/retry —
// because Next.js requires one dynamic segment name per directory
// level, and the UI already has latest_version_id on hand from
// /api/documents/list. The route just resolves documentId first.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { versionId } = await params;

  try {
    const documentId = await withAuthContext(ctx, async (client) => {
      const res = await client.query<{ document_id: string }>(
        `SELECT document_id FROM document_versions WHERE id = $1`,
        [versionId]
      );
      return res.rows[0]?.document_id ?? null;
    });
    if (!documentId) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const result = await deleteDocument(ctx, documentId);
    return NextResponse.json(result);
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
    console.error("POST /api/documents/[versionId]/delete: unexpected error", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
