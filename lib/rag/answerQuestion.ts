import { retrieveAuthorizedChunks, type RetrievedChunk } from "./retrieveAuthorizedChunks.ts";
import { buildSourceBlocks, renderContext, SYSTEM_PROMPT, type SourceBlock } from "./buildPrompt.ts";
import { writeRagAudit } from "./audit.ts";
import { getLlmProvider } from "../llm/index.ts";
import { LlmError } from "../llm/types.ts";
import type { AuthContext } from "../permissions/authContext.ts";

// Configurable via env — see .env.example. Not calibrated on a real
// corpus yet; conservative default matches Phase 3 baseline.
const MIN_SIMILARITY = Number(process.env.RAG_MIN_SIMILARITY ?? 0.3);
// Minimum number of chunks required before calling the LLM. A single
// very relevant chunk is sufficient; this guards against edge cases
// where the similarity gate passes but the context is trivially thin.
const MIN_CHUNKS = Number(process.env.RAG_MIN_CHUNKS ?? 1);
const DEFAULT_K = Number(process.env.RAG_K ?? 5);

export interface RagCitation {
  chunkId: string;
  documentId: string;
  documentVersionId: string;
  documentTitle: string;
  versionNumber: number;
  pageNumber: number | null;
  snippetText: string;
  /** 1-based index matching [SOURCE n] in the answer text. */
  sourceIndex: number;
}

export interface RagAnswer {
  answer: string;
  citations: RagCitation[];
  refusal: false;
  metadata: {
    model: string;
    latencyMs: number;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    sourceCount: number;
  };
}

export interface RagRefusal {
  answer: null;
  citations: [];
  refusal: true;
  reason: string;
  metadata: {
    sourceCount: number;
  };
}

export type RagResult = RagAnswer | RagRefusal;

const REFUSAL_MESSAGE =
  "I don't have enough authorized sources to answer this question.";

/**
 * The single entry point for RAG generation. Security invariants:
 *
 * 1. ctx comes from the server-side JWT — never from client input.
 * 2. retrieveAuthorizedChunks runs under app_role + RLS: only chunks
 *    the authenticated user is allowed to see are ever returned.
 * 3. The LLM is called ONLY when sufficient authorized chunks exist.
 * 4. Citations are validated against the retrieved set — the LLM
 *    cannot fabricate a chunk ID that was not in this request.
 * 5. Audit is written after every request, success or failure.
 */
export async function answerQuestion(ctx: AuthContext, question: string): Promise<RagResult> {
  if (!question.trim()) {
    throw new Error("answerQuestion: question must not be empty");
  }

  const start = Date.now();

  // ── 1. Authorized retrieval (RLS enforced inside) ──────────────────
  const retrieval = await retrieveAuthorizedChunks(ctx, question, {
    k: DEFAULT_K,
    minSimilarity: MIN_SIMILARITY,
  });

  // ── 2. Source sufficiency gate ─────────────────────────────────────
  if (retrieval.noSource || retrieval.chunks.length < MIN_CHUNKS) {
    await writeRagAudit(ctx, {
      action: "rag_refusal",
      sourceCount: retrieval.chunks.length,
      refusal: true,
      modelUsed: null,
      latencyMs: Date.now() - start,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      errorCategory: null,
      questionLength: question.length,
      chunkIds: [],
    });
    return {
      answer: null,
      citations: [],
      refusal: true,
      reason: REFUSAL_MESSAGE,
      metadata: { sourceCount: retrieval.chunks.length },
    };
  }

  // ── 3. Build grounded prompt ───────────────────────────────────────
  const sources = buildSourceBlocks(retrieval.chunks);
  const contextText = renderContext(sources);

  // ── 4. Call LLM ───────────────────────────────────────────────────
  let llmResponse;
  try {
    const provider = getLlmProvider();
    llmResponse = await provider.complete({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `${contextText}\n\nQUESTION: ${question}` },
      ],
      temperature: 0,
    });
  } catch (err) {
    const errorCategory = err instanceof LlmError ? err.code : "UNKNOWN";
    await writeRagAudit(ctx, {
      action: "rag_error",
      sourceCount: retrieval.chunks.length,
      refusal: false,
      modelUsed: null,
      latencyMs: Date.now() - start,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      errorCategory,
      questionLength: question.length,
      chunkIds: retrieval.chunks.map((c) => c.chunkId),
    });
    throw err;
  }

  // ── 5. Extract and validate citations ─────────────────────────────
  const citations = extractCitations(llmResponse.content, sources, retrieval.chunks);

  // ── 6. Audit ──────────────────────────────────────────────────────
  await writeRagAudit(ctx, {
    action: "rag_answer",
    sourceCount: retrieval.chunks.length,
    refusal: false,
    modelUsed: llmResponse.model,
    latencyMs: llmResponse.latencyMs,
    promptTokens: llmResponse.usage?.promptTokens ?? null,
    completionTokens: llmResponse.usage?.completionTokens ?? null,
    totalTokens: llmResponse.usage?.totalTokens ?? null,
    errorCategory: null,
    questionLength: question.length,
    chunkIds: retrieval.chunks.map((c) => c.chunkId),
  });

  return {
    answer: llmResponse.content,
    citations,
    refusal: false,
    metadata: {
      model: llmResponse.model,
      latencyMs: llmResponse.latencyMs,
      promptTokens: llmResponse.usage?.promptTokens ?? null,
      completionTokens: llmResponse.usage?.completionTokens ?? null,
      totalTokens: llmResponse.usage?.totalTokens ?? null,
      sourceCount: retrieval.chunks.length,
    },
  };
}

/**
 * Parses [SOURCE n] references from the LLM answer and maps them back
 * to real chunk metadata. Only indices that were actually supplied to
 * the LLM (1..sources.length) are accepted — any out-of-range or
 * fabricated index is silently dropped (defense in depth: the LLM
 * cannot invent a citation that references a chunk it never saw).
 */
export function extractCitations(
  answer: string,
  sources: SourceBlock[],
  chunks: RetrievedChunk[]
): RagCitation[] {
  const mentioned = new Set<number>();
  // The model is instructed to emit ASCII "[SOURCE n]", but in practice
  // it sometimes substitutes fullwidth CJK brackets (U+3010/U+3011,
  // U+FF3B/U+FF3D) or inserts a zero-width character (U+200B-200D,
  // U+FEFF) right after the opening bracket — observed empirically
  // against the real Groq/gpt-oss-120b provider, not just the
  // ASCII-only mock used in tests. Strip invisible characters and
  // accept any of the common bracket variants so a citation isn't
  // silently lost to formatting drift the model doesn't fully control.
  const ZERO_WIDTH = /[​-‍﻿]/g;
  const normalized = answer.replace(ZERO_WIDTH, "");
  const pattern = /[[［【]\s*SOURCE\s+(\d+)\s*[\]］】]/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normalized)) !== null) {
    mentioned.add(Number(match[1]));
  }

  const citations: RagCitation[] = [];
  for (const idx of mentioned) {
    const source = sources.find((s) => s.index === idx);
    if (!source) continue; // fabricated index — drop silently
    const chunk = chunks.find((c) => c.chunkId === source.chunkId);
    if (!chunk) continue; // should never happen, but guard anyway
    citations.push({
      chunkId: source.chunkId,
      documentId: source.documentId,
      documentVersionId: source.documentVersionId,
      documentTitle: source.documentTitle,
      versionNumber: source.versionNumber,
      pageNumber: source.pageNumber,
      snippetText: source.content,
      sourceIndex: idx,
    });
  }
  return citations;
}
