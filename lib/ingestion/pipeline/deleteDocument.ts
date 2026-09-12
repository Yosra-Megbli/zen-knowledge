import { withAuthContext } from "../../db/withAuthContext.ts";
import type { AuthContext } from "../../permissions/authContext.ts";
import { IngestionError, IngestionForbiddenError, IngestionNotFoundError } from "../errors.ts";

/**
 * Soft-deletes a document. Sets documents.status = 'deleted', which
 * the documents_propagate_auth_change trigger (db/migrations/0008,
 * made SECURITY DEFINER in 0013) then propagates to
 * document_chunks.document_status on every version's chunks — RLS's
 * document_chunks_select policy requires document_status = 'published',
 * so this alone makes every chunk of the document immediately
 * invisible to retrieval, no separate code path needed.
 *
 * Does NOT touch document_versions.status or document_chunks rows
 * directly, and does NOT delete any row — a deleted document's
 * metadata, versions, and chunks all still exist, just excluded by
 * RLS/route-level checks (see app/api/documents/[versionId]/file and
 * the preview page, both gated on documents.status = 'deleted'). This
 * is what keeps historical citations resolvable (title, "supprimé"
 * badge) instead of dangling on a hard-deleted row.
 */
export async function deleteDocument(ctx: AuthContext, documentId: string): Promise<{ deleted: true }> {
  // Same threshold as publishVersion.ts — the closest existing
  // precedent for a state-changing document action. Deletion isn't
  // restricted to the original owner: like publish, any contributor/
  // admin in the company can act on any of the company's documents.
  if (ctx.role === "employee") {
    throw new IngestionForbiddenError("employee accounts cannot delete documents");
  }

  await withAuthContext(ctx, async (client) => {
    const res = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM documents WHERE id = $1`,
      [documentId]
    );
    if (res.rowCount === 0) {
      throw new IngestionNotFoundError("Document not found.");
    }
    if (res.rows[0].status === "deleted") {
      throw new IngestionError("DOCUMENT_DELETED", "Document is already deleted.");
    }

    await client.query(
      `UPDATE documents SET status = 'deleted', deleted_at = now() WHERE id = $1`,
      [documentId]
    );
  });

  return { deleted: true };
}
