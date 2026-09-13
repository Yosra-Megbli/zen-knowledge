import { withAuthContext } from "../../db/withAuthContext.ts";
import type { AuthContext } from "../../permissions/authContext.ts";
import { IngestionNotFoundError } from "../errors.ts";

/**
 * Archives a published document.
 * Sets the document status to 'archived' and marks its current version as 'archived'.
 * Database triggers propagate document_status = 'archived' to document_chunks,
 * immediately excluding its chunks from RAG vector retrieval.
 */
export async function archiveDocument(
  ctx: AuthContext,
  documentId: string
): Promise<{ archived: true; documentId: string }> {
  return withAuthContext(ctx, async (client) => {
    const docRes = await client.query<{ id: string; current_version_id: string | null }>(
      `SELECT id, current_version_id FROM documents WHERE id = $1 AND status = 'published'`,
      [documentId]
    );
    if (docRes.rowCount === 0) {
      throw new IngestionNotFoundError("Document not found or not in published status.");
    }
    const currentVersionId = docRes.rows[0].current_version_id;

    await client.query(
      `UPDATE documents SET status = 'archived', updated_at = now() WHERE id = $1`,
      [documentId]
    );

    if (currentVersionId) {
      await client.query(
        `UPDATE document_versions SET status = 'archived', archived_at = now() WHERE id = $1`,
        [currentVersionId]
      );
    }

    return { archived: true, documentId };
  });
}
