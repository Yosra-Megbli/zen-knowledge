import { withAuthContext } from "../../db/withAuthContext.ts";
import type { AuthContext } from "../../permissions/authContext.ts";
import { IngestionError, IngestionForbiddenError, IngestionNotFoundError } from "../errors.ts";

/**
 * The ONLY path by which a DocumentVersion can become 'published'.
 * Deliberately separate from ingestDocument(): upload/ingestion NEVER
 * publishes automatically, no matter how cleanly it succeeded — a
 * human/API call must explicitly request publication, and only a
 * version that finished ingestion in 'ready' status is eligible. A
 * 'failed' version can never reach this state.
 */
export async function publishVersion(ctx: AuthContext, documentVersionId: string): Promise<{ published: true }> {
  if (ctx.role === "employee") {
    throw new IngestionForbiddenError("employee accounts cannot publish documents");
  }

  await withAuthContext(ctx, async (client) => {
    const versionRes = await client.query<{ id: string; document_id: string; status: string }>(
      `SELECT id, document_id, status FROM document_versions WHERE id = $1`,
      [documentVersionId]
    );
    if (versionRes.rowCount === 0) {
      throw new IngestionNotFoundError("Document version not found.");
    }
    const version = versionRes.rows[0];
    if (version.status !== "ready") {
      throw new IngestionError(
        "INVALID_METADATA",
        `Only a version with status 'ready' can be published (current status: '${version.status}').`
      );
    }

    // Archive any currently published version FIRST, so the
    // one-published-version-per-document constraint is never violated
    // even momentarily within this transaction.
    await client.query(
      `UPDATE document_versions SET status = 'archived', archived_at = now()
       WHERE document_id = $1 AND status = 'published'`,
      [version.document_id]
    );

    await client.query(
      `UPDATE document_versions SET status = 'published', published_at = now() WHERE id = $1`,
      [documentVersionId]
    );
    await client.query(
      `UPDATE documents SET status = 'published', current_version_id = $1 WHERE id = $2`,
      [documentVersionId, version.document_id]
    );
  });

  return { published: true };
}
