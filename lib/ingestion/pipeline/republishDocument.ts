import { withAuthContext } from "../../db/withAuthContext.ts";
import type { AuthContext } from "../../permissions/authContext.ts";
import { IngestionNotFoundError } from "../errors.ts";

/**
 * Republishes a previously unpublished document.
 * Sets the document back to 'published' and marks its target version as 'published'.
 * Triggers from 0008/0013 automatically propagate the status to document_chunks,
 * making them immediately retrievable again in RAG / Chat search.
 */
export async function republishDocument(
  ctx: AuthContext,
  documentId: string
): Promise<{ documentVersionId: string }> {
  return withAuthContext(ctx, async (client) => {
    const docRes = await client.query<{ id: string; current_version_id: string | null }>(
      `SELECT id, current_version_id FROM documents WHERE id = $1 AND status IN ('unpublished', 'archived')`,
      [documentId]
    );
    if (docRes.rowCount === 0) {
      throw new IngestionNotFoundError("Document not found or not in unpublished/archived status.");
    }
    const currentVersionId = docRes.rows[0].current_version_id;

    let targetVersionId = currentVersionId;
    if (!targetVersionId) {
      const vRes = await client.query<{ id: string }>(
        `SELECT id FROM document_versions WHERE document_id = $1 ORDER BY version_number DESC LIMIT 1`,
        [documentId]
      );
      if (vRes.rowCount === 0) {
        throw new IngestionNotFoundError("No version found for document.");
      }
      targetVersionId = vRes.rows[0].id;
    }

    // Update document to published
    await client.query(
      `UPDATE documents SET status = 'published', current_version_id = $1, updated_at = now() WHERE id = $2`,
      [targetVersionId, documentId]
    );

    // Update version to published
    await client.query(
      `UPDATE document_versions SET status = 'published', published_at = now() WHERE id = $1`,
      [targetVersionId]
    );

    return { documentVersionId: targetVersionId };
  });
}
