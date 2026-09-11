import { withAuthContext } from "../../db/withAuthContext.ts";
import type { AuthContext } from "../../permissions/authContext.ts";
import { IngestionNotFoundError } from "../errors.ts";

/**
 * Reverses publishVersion.ts: archives the currently published version
 * and sets the document back to 'unpublished'. Chunks become
 * unretrievable immediately (the same propagate_version_auth_change /
 * propagate_document_auth_change triggers from 0008/0013 keep
 * document_chunks in sync, exactly as for a normal publish/archive).
 *
 * Unlike publishVersion(), this does NOT check ctx.role. Reasoning:
 * publishVersion()'s employee-forbidden check protects against a
 * USER-initiated request (any authenticated employee hitting the API
 * directly) — the trust boundary there is the role itself. This
 * function is only ever reachable through POST /api/n8n/unpublish,
 * gated by the N8N_WEBHOOK_SECRET shared secret — a different, already
 *-verified trust boundary (the caller is the trusted n8n W3 cron, not
 * an arbitrary user). Requiring the resolved acting context to also
 * happen to be 'admin' would make automated obsolescence enforcement
 * silently no-op whenever a document's owner is an employee, which is
 * a logic bug, not a security property worth enforcing twice.
 */
export async function unpublishDocument(ctx: AuthContext, documentId: string): Promise<{ documentVersionId: string | null }> {
  return withAuthContext(ctx, async (client) => {
    const docRes = await client.query<{ id: string; current_version_id: string | null }>(
      `SELECT id, current_version_id FROM documents WHERE id = $1 AND status = 'published'`,
      [documentId]
    );
    if (docRes.rowCount === 0) {
      throw new IngestionNotFoundError("Document not found or not currently published.");
    }
    const { current_version_id: currentVersionId } = docRes.rows[0];

    await client.query(`UPDATE documents SET status = 'unpublished' WHERE id = $1`, [documentId]);

    if (currentVersionId) {
      await client.query(
        `UPDATE document_versions SET status = 'archived', archived_at = now() WHERE id = $1 AND status = 'published'`,
        [currentVersionId]
      );
    }

    return { documentVersionId: currentVersionId };
  });
}
