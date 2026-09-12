import { NextResponse } from "next/server";
import { getAuthContext } from "../../../../../lib/permissions/authContext.ts";
import { canAccessDocumentVisibility } from "../../../../../lib/permissions/documentVisibility.ts";
import { withAuthContext } from "../../../../../lib/db/withAuthContext.ts";
import { storageProvider } from "../../../../../lib/storage/index.ts";

// GET /api/documents/[versionId]/file
// Auth: session required. RLS on document_versions only enforces
// COMPANY isolation (by design — see db/migrations/0009, "documents
// RLS: company-isolation-only, for the library management use case").
// It does NOT enforce visibility (company/department/restricted) the
// way document_chunks_select does for retrieval. This route must
// therefore replicate that same visibility check itself — otherwise an
// employee could download the raw file of a "restricted" document
// (admin-only) simply by knowing its versionId (e.g. surfaced via
// /api/documents/list, which — also by design — lists metadata for
// every document in the company regardless of visibility).
//
// Status handling is deliberate: a document's own status is
// 'deleted' (documents.status — document_versions.status has no such
// value, only 'archived'), and that alone gets 410 Gone, checked
// AFTER the visibility check so a disallowed-and-deleted document
// still reads as a plain 404, never distinguishing the two.
// 'archived' (a superseded but not deleted version) stays fully
// downloadable — historical citations must remain verifiable.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { versionId } = await params;

  const row = await withAuthContext(ctx, async (client) => {
    const res = await client.query<{
      file_key: string;
      file_type: string;
      title: string;
      visibility: string;
      department_id: string | null;
      document_status: string;
    }>(
      `SELECT v.file_key, v.file_type, d.title, d.visibility, d.department_id, d.status AS document_status
       FROM document_versions v
       JOIN documents d ON d.id = v.document_id
       WHERE v.id = $1 AND v.file_key IS NOT NULL AND v.file_key != 'pending'`,
      [versionId]
    );
    return res.rows[0] ?? null;
  });

  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Returns 404 (not 403) so a disallowed file's existence is never
  // distinguished from a missing one.
  if (!canAccessDocumentVisibility(ctx, { visibility: row.visibility, departmentId: row.department_id })) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (row.document_status === "deleted") {
    return NextResponse.json({ error: "document deleted" }, { status: 410 });
  }

  let data: Buffer;
  try {
    data = await storageProvider.read(row.file_key);
  } catch {
    return NextResponse.json({ error: "file not available" }, { status: 404 });
  }

  const contentType =
    row.file_type === "pdf" ? "application/pdf" :
    row.file_type === "txt" ? "text/plain; charset=utf-8" :
    "application/octet-stream";

  const safeName = row.title.replace(/[^a-zA-Z0-9._-]/g, "_");
  const ext = row.file_type === "pdf" ? ".pdf" : row.file_type === "txt" ? ".txt" : "";

  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${safeName}${ext}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
