import { NextResponse } from "next/server";
import { getAuthContext } from "../../../../../lib/permissions/authContext.ts";
import { withAuthContext } from "../../../../../lib/db/withAuthContext.ts";
import { storageProvider } from "../../../../../lib/storage/index.ts";

// GET /api/documents/[versionId]/file
// Auth: session required. RLS on document_versions ensures the user can
// only read versions belonging to their company. file_key is never
// accepted from the client — always read from the DB under RLS.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { versionId } = await params;

  const row = await withAuthContext(ctx, async (client) => {
    const res = await client.query<{ file_key: string; file_type: string; title: string }>(
      `SELECT v.file_key, v.file_type, d.title
       FROM document_versions v
       JOIN documents d ON d.id = v.document_id
       WHERE v.id = $1 AND v.file_key IS NOT NULL AND v.file_key != 'pending'`,
      [versionId]
    );
    return res.rows[0] ?? null;
  });

  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

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
