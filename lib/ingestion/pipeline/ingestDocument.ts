import { withAuthContext } from "../../db/withAuthContext.ts";
import { embedPassage } from "../../embeddings/index.ts";
import { storageProvider } from "../../storage/index.ts";
import type { AuthContext } from "../../permissions/authContext.ts";
import { cleanText } from "../clean/cleanText.ts";
import { chunkPages } from "../chunk/chunkText.ts";
import { extractText } from "../extract/index.ts";
import { validateUploadedFile } from "../validate.ts";
import { IngestionError, IngestionForbiddenError, IngestionNotFoundError, type IngestionErrorCode } from "../errors.ts";

export type DocumentVisibility = "company" | "department" | "restricted";

export type IngestDocumentTarget =
  | {
      kind: "new";
      title: string;
      description?: string | null;
      departmentId?: string | null;
      visibility: DocumentVisibility;
      reviewDate?: string | null;
    }
  | { kind: "version"; documentId: string };

export interface IngestDocumentInput {
  ctx: AuthContext;
  fileName: string;
  data: Buffer;
  target: IngestDocumentTarget;
  triggeredBy: string;
}

export interface IngestDocumentResult {
  documentId: string;
  documentVersionId: string;
  ingestionJobId: string;
  status: "completed" | "failed";
  chunkCount: number;
  errorCode?: IngestionErrorCode;
  errorMessage?: string;
}

/**
 * The single entry point for turning an uploaded file into a
 * DocumentVersion + DocumentChunk rows. Runs entirely through app_role
 * (withAuthContext) — never migration_role. A newly ingested version
 * ends in status 'ready' at best, NEVER 'published': see
 * publishVersion.ts for the separate, explicit publication step.
 */
export async function ingestDocument(input: IngestDocumentInput): Promise<IngestDocumentResult> {
  const { ctx, fileName, data, target, triggeredBy } = input;

  // 1. Validate the file BEFORE any database writes — a rejected file
  // must never leave behind a half-created Document/DocumentVersion/
  // IngestionJob row.
  const validated = validateUploadedFile(fileName, data);

  if (target.kind === "new" && target.visibility === "restricted" && ctx.role === "employee") {
    throw new IngestionForbiddenError("employee accounts cannot create restricted-visibility documents");
  }

  // 2. Resolve/create the Document and create the new DocumentVersion +
  // IngestionJob rows. Entirely inside app_role + RLS: if target is an
  // existing documentId belonging to another company, the SELECT below
  // returns zero rows (RLS), which is treated identically to "does not
  // exist" — never distinguished, so cross-company existence is never
  // leaked either way.
  const created = await withAuthContext(ctx, async (client) => {
    let documentId: string;

    if (target.kind === "new") {
      if (target.departmentId) {
        const dept = await client.query(`SELECT id FROM departments WHERE id = $1`, [target.departmentId]);
        if (dept.rowCount === 0) {
          throw new IngestionError("INVALID_METADATA", "department_id does not belong to your company.");
        }
      }
      const docRes = await client.query<{ id: string }>(
        `INSERT INTO documents (company_id, department_id, owner_id, title, description, visibility, status, review_date)
         VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7)
         RETURNING id`,
        [ctx.companyId, target.departmentId ?? null, ctx.userId, target.title, target.description ?? null, target.visibility, target.reviewDate ?? null]
      );
      documentId = docRes.rows[0].id;
    } else {
      const docRes = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM documents WHERE id = $1`,
        [target.documentId]
      );
      if (docRes.rowCount === 0) {
        throw new IngestionNotFoundError();
      }
      if (docRes.rows[0].status === "deleted") {
        throw new IngestionError("DOCUMENT_DELETED", "Cannot add a new version to a deleted document.");
      }
      documentId = docRes.rows[0].id;
    }

    const versionNumberRes = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS next FROM document_versions WHERE document_id = $1`,
      [documentId]
    );
    const versionNumber = versionNumberRes.rows[0].next;

    const versionRes = await client.query<{ id: string }>(
      `INSERT INTO document_versions (document_id, company_id, version_number, status, file_key, file_type, uploaded_by)
       VALUES ($1, $2, $3, 'processing', 'pending', $4, $5)
       RETURNING id`,
      [documentId, ctx.companyId, versionNumber, validated.type, ctx.userId]
    );
    const documentVersionId = versionRes.rows[0].id;

    const jobRes = await client.query<{ id: string }>(
      `INSERT INTO ingestion_jobs (document_version_id, company_id, status, triggered_by, started_at)
       VALUES ($1, $2, 'processing', $3, now())
       RETURNING id`,
      [documentVersionId, ctx.companyId, triggeredBy]
    );

    return { documentId, documentVersionId, ingestionJobId: jobRes.rows[0].id };
  });

  const { documentId, documentVersionId, ingestionJobId } = created;

  try {
    // 3. Store the raw file. Failure here must fail the job, not throw
    // out to the caller as an unhandled 500.
    let fileKey: string;
    try {
      const ref = await storageProvider.save({
        companyId: ctx.companyId,
        documentId,
        versionId: documentVersionId,
        fileName: validated.fileName,
        data: validated.data,
      });
      fileKey = ref.key;
    } catch (err) {
      throw new IngestionError("STORAGE_FAILURE", `Failed to store uploaded file: ${(err as Error).message}`);
    }

    await withAuthContext(ctx, (client) =>
      client.query(`UPDATE document_versions SET file_key = $1 WHERE id = $2`, [fileKey, documentVersionId])
    );

    // 4. Extract (throws IngestionError for corrupted/no-text files).
    const extraction = await extractText(validated.type, validated.data);

    // 5. Clean.
    const cleanedPages = extraction.pages.map((p) => ({ pageNumber: p.pageNumber, text: cleanText(p.text) }));
    const totalCleanedChars = cleanedPages.reduce((sum, p) => sum + p.text.length, 0);
    if (totalCleanedChars === 0) {
      throw new IngestionError("EMPTY_TEXT_AFTER_CLEANING", "No usable text remained after cleaning.");
    }

    // 6. Chunk.
    const pageChunks = chunkPages(cleanedPages);
    if (pageChunks.length === 0) {
      throw new IngestionError("EMPTY_TEXT_AFTER_CLEANING", "Cleaning/chunking produced zero chunks.");
    }

    // 7. Embed locally (reuses the existing Phase 3 provider — no
    // second embedding implementation).
    const embedded: { content: string; pageNumber: number | null; embedding: number[] }[] = [];
    for (const chunk of pageChunks) {
      let embedding: number[];
      try {
        embedding = await embedPassage(chunk.content);
      } catch (err) {
        throw new IngestionError("EMBEDDING_FAILURE", `Local embedding generation failed: ${(err as Error).message}`);
      }
      embedded.push({ content: chunk.content, pageNumber: chunk.pageNumber, embedding });
    }

    // 8. Persist all chunks in a single multi-row INSERT (one DB
    // round-trip instead of N sequential ones). The BEFORE INSERT
    // trigger from Phase 2 (set_document_chunk_auth_columns) derives
    // company_id/department_id/visibility/document_status/version_status
    // from document_version_id for every row — never accepted from the
    // caller.
    await withAuthContext(ctx, async (client) => {
      const values: string[] = [];
      const params: unknown[] = [];
      embedded.forEach((chunk, i) => {
        const base = i * 5;
        values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::vector)`);
        params.push(documentVersionId, i, chunk.content, chunk.pageNumber, `[${chunk.embedding.join(",")}]`);
      });
      await client.query(
        `INSERT INTO document_chunks (document_version_id, chunk_index, content, page_number, embedding)
         VALUES ${values.join(", ")}`,
        params
      );
    });

    // 9. Mark ready (NEVER published — see publishVersion.ts).
    await withAuthContext(ctx, (client) =>
      client.query(`UPDATE document_versions SET status = 'ready' WHERE id = $1`, [documentVersionId])
    );
    await withAuthContext(ctx, (client) =>
      client.query(
        `UPDATE ingestion_jobs SET status = 'completed', finished_at = now(), chunk_count = $1 WHERE id = $2`,
        [embedded.length, ingestionJobId]
      )
    );

    return { documentId, documentVersionId, ingestionJobId, status: "completed", chunkCount: embedded.length };
  } catch (err) {
    const code: IngestionErrorCode = err instanceof IngestionError ? err.code : "DATABASE_FAILURE";
    // Never log/store full document content — only the error message,
    // which is a fixed, code-driven string (see errors.ts), never
    // interpolates extracted document text.
    const message = err instanceof Error ? err.message : "Unknown ingestion failure";

    await withAuthContext(ctx, (client) =>
      client.query(`UPDATE document_versions SET status = 'failed' WHERE id = $1`, [documentVersionId])
    );
    await withAuthContext(ctx, (client) =>
      client.query(
        `UPDATE ingestion_jobs SET status = 'failed', finished_at = now(), error_code = $1, error_message = $2 WHERE id = $3`,
        [code, message, ingestionJobId]
      )
    );

    return {
      documentId,
      documentVersionId,
      ingestionJobId,
      status: "failed",
      chunkCount: 0,
      errorCode: code,
      errorMessage: message,
    };
  }
}
