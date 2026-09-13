import { withAuthContext } from "../../db/withAuthContext.ts";
import { storageProvider } from "../../storage/index.ts";
import type { AuthContext } from "../../permissions/authContext.ts";
import { IngestionError, IngestionForbiddenError, IngestionNotFoundError } from "../errors.ts";
import { ingestDocument, type IngestDocumentResult } from "./ingestDocument.ts";
import { publishVersion } from "./publishVersion.ts";

/**
 * Re-runs the ingestion pipeline for a version, reusing the file bytes
 * already in storage instead of requiring a fresh upload. Always produces
 * a NEW document_version row.
 *
 * - Archived documents cannot be retried (must be unarchived first).
 * - Published documents can be re-indexed; upon completion, the newly
 *   created version is automatically published to keep the document active.
 * - Failed versions can be retried to produce a new ready version.
 */
export async function retryFailedVersion(
  ctx: AuthContext,
  documentVersionId: string,
  triggeredBy: string
): Promise<IngestDocumentResult> {
  if (ctx.role === "employee") {
    throw new IngestionForbiddenError("Les comptes employés ne peuvent pas réindexer de document.");
  }

  const version = await withAuthContext(ctx, async (client) => {
    const res = await client.query<{ id: string; document_id: string; status: string; file_key: string; doc_status: string }>(
      `SELECT v.id, v.document_id, v.status, v.file_key, d.status AS doc_status
       FROM document_versions v
       JOIN documents d ON d.id = v.document_id
       WHERE v.id = $1`,
      [documentVersionId]
    );
    if (res.rowCount === 0) {
      throw new IngestionNotFoundError("Version de document introuvable.");
    }
    return res.rows[0];
  });

  if (version.status === "archived" || version.doc_status === "archived") {
    throw new IngestionError(
      "INVALID_METADATA",
      "Impossible de réindexer un document archivé. Réactivez d'abord le document."
    );
  }

  if (version.status !== "failed" && version.status !== "published" && version.status !== "ready") {
    throw new IngestionError(
      "INVALID_METADATA",
      `Impossible de réindexer un document avec le statut '${version.status}'.`
    );
  }

  if (version.file_key === "pending") {
    throw new IngestionError(
      "STORAGE_FAILURE",
      "Le fichier original n'a pas été stocké correctement — veuillez téléverser une nouvelle version."
    );
  }

  const data = await storageProvider.read(version.file_key);
  const fileName = version.file_key.split("/").pop() ?? "file";

  const result = await ingestDocument({
    ctx,
    fileName,
    data,
    target: { kind: "version", documentId: version.document_id },
    triggeredBy,
  });

  // If the document was previously published, automatically publish the new version
  if ((version.status === "published" || version.doc_status === "published") && result.status === "completed") {
    await publishVersion(ctx, result.documentVersionId);
  }

  return result;
}
