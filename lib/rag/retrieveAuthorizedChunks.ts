import { withAuthContext } from "../db/withAuthContext.ts";
import { embedQuery } from "../embeddings/index.ts";
import type { AuthContext } from "../permissions/authContext.ts";

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentVersionId: string;
  documentTitle: string;
  versionNumber: number;
  pageNumber: number | null;
  content: string;
  similarity: number;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  noSource: boolean;
  minSimilarity: number;
}

// Not a final calibrated value — deliberately conservative and easy to
// override, exactly as instructed: "do not blindly choose an arbitrary
// final threshold". Calibrate once the demo dataset (or real content)
// is large/varied enough to observe the real score distribution.
// This governs ANSWER RELEVANCE only — it runs strictly AFTER
// authorization has already narrowed the candidate set to rows RLS
// allowed; it never widens or bypasses that set.
const DEFAULT_MIN_SIMILARITY = Number(process.env.RAG_MIN_SIMILARITY ?? 0.3);
const DEFAULT_K = 5;

interface Row {
  chunk_id: string;
  document_id: string;
  document_version_id: string;
  document_title: string;
  version_number: number;
  page_number: number | null;
  content: string;
  similarity: number;
  company_id: string;
}

/**
 * The single, mandatory entry point for retrieving document_chunks.
 * No other function in this codebase is allowed to query that table.
 *
 * Authorization is NOT a TypeScript filter applied to a broader result
 * set — it happens INSIDE the SQL query, enforced by PostgreSQL RLS
 * (db/migrations/0009_rls_and_grants.sql, document_chunks_select),
 * which is evaluated as part of the same query that computes vector
 * distance. This function only ever runs on the app_role connection
 * (see lib/db/withAuthContext.ts / lib/db/appPool.ts) — migration_role
 * is never reachable from this code path.
 */
export async function retrieveAuthorizedChunks(
  ctx: AuthContext,
  query: string,
  opts: { k?: number; minSimilarity?: number } = {}
): Promise<RetrievalResult> {
  if (!query.trim()) {
    throw new Error("retrieveAuthorizedChunks: query must not be empty");
  }

  const k = opts.k ?? DEFAULT_K;
  const minSimilarity = opts.minSimilarity ?? DEFAULT_MIN_SIMILARITY;

  const queryEmbedding = await embedQuery(query);
  const vectorLiteral = `[${queryEmbedding.join(",")}]`;

  const rows = await withAuthContext(ctx, async (client) => {
    const res = await client.query<Row>(
      `SELECT
         dc.id AS chunk_id,
         dc.document_id,
         dc.document_version_id,
         dc.company_id,
         d.title AS document_title,
         v.version_number,
         dc.page_number,
         dc.content,
         1 - (dc.embedding <=> $1::vector) AS similarity
       FROM document_chunks dc
       JOIN documents d ON d.id = dc.document_id
       JOIN document_versions v ON v.id = dc.document_version_id
       WHERE dc.embedding IS NOT NULL
       ORDER BY dc.embedding <=> $1::vector
       LIMIT $2`,
      [vectorLiteral, k]
    );
    return res.rows;
  });

  // Defense in depth: RLS already guarantees this, but a violation
  // here would indicate a serious bug worth failing loudly on, not a
  // normal code path to rely on for security.
  for (const row of rows) {
    if (row.company_id !== ctx.companyId) {
      throw new Error(
        "retrieveAuthorizedChunks: row from a different company than the authorization context — RLS violation, refusing to return results"
      );
    }
  }

  const chunks: RetrievedChunk[] = rows
    .filter((row) => row.similarity >= minSimilarity)
    .map((row) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      documentVersionId: row.document_version_id,
      documentTitle: row.document_title,
      versionNumber: row.version_number,
      pageNumber: row.page_number,
      content: row.content,
      similarity: row.similarity,
    }));

  return { chunks, noSource: chunks.length === 0, minSimilarity };
}
