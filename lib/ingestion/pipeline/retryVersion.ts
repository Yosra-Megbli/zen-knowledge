import { withAuthContext } from "../../db/withAuthContext.ts";
import { storageProvider } from "../../storage/index.ts";
import type { AuthContext } from "../../permissions/authContext.ts";
import { IngestionError, IngestionForbiddenError, IngestionNotFoundError } from "../errors.ts";
import { ingestDocument, type IngestDocumentResult } from "./ingestDocument.ts";

/**
 * Re-runs the ingestion pipeline for a version that previously failed,
 * reusing the file bytes already in storage instead of requiring a
 * fresh upload. Always produces a NEW document_version row (same
 * pattern as any other re-ingestion) — the failed one is left as a
 * permanent record, never overwritten.
 *
 * Only possible when the original file actually made it to storage:
 * a STORAGE_FAILURE means file_key is still the 'pending' placeholder,
 * in which case there is nothing to re-read and the caller must
 * re-upload instead.
 */
export async function retryFailedVersion(
  ctx: AuthContext,
  documentVersionId: string,
  triggeredBy: string
): Promise<IngestDocumentResult> {
  if (ctx.role === "employee") {
    throw new IngestionForbiddenError("employee accounts cannot retry ingestion");
  }

  const version = await withAuthContext(ctx, async (client) => {
    const res = await client.query<{ id: string; document_id: string; status: string; file_key: string }>(
      `SELECT id, document_id, status, file_key FROM document_versions WHERE id = $1`,
      [documentVersionId]
    );
    if (res.rowCount === 0) {
      throw new IngestionNotFoundError("Document version not found.");
    }
    return res.rows[0];
  });

  if (version.status !== "failed") {
    throw new IngestionError(
      "INVALID_METADATA",
      `Only a version with status 'failed' can be retried (current status: '${version.status}').`
    );
  }
  if (version.file_key === "pending") {
    throw new IngestionError(
      "STORAGE_FAILURE",
      "The original file was never successfully stored — re-upload a new version instead of retrying."
    );
  }

  const data = await storageProvider.read(version.file_key);
  const fileName = version.file_key.split("/").pop() ?? "file";

  return ingestDocument({
    ctx,
    fileName,
    data,
    target: { kind: "version", documentId: version.document_id },
    triggeredBy,
  });
}
