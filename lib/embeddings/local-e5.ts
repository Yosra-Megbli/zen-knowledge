// Note: no `import "server-only"` guard here — it throws outside
// Next.js's own bundler (e.g. under plain `node`), which would break
// this module's direct unit-testability via node:test. Server-only
// usage is enforced instead by discipline: nothing in app/ with
// 'use client' imports this module, and its dependencies (ONNX runtime
// on Node, filesystem model cache) are meaningless in a browser anyway.
// Revisit if a client component ever needs to import from lib/embeddings.
import os from "node:os";
import path from "node:path";
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import type { EmbeddingProvider } from "./types.ts";
import { queryInput, passageInput } from "./prefixes.ts";

const MODEL_ID = process.env.EMBEDDING_MODEL ?? "Xenova/multilingual-e5-small";
const DIMENSION = Number(process.env.EMBEDDING_DIMENSION ?? 384);

// Local cache so the ~100MB quantized model is only downloaded once
// across runs, not re-fetched on every process start. Gitignored
// (matches the existing ".cache/" entry in .gitignore) for local dev.
//
// On Vercel, the deployed function's own directory (where "./.cache"
// would resolve) is READ-ONLY — only os.tmpdir() (/tmp) is writable.
// Writing there previously crashed every request that needed an
// embedding (query retrieval, ingestion) with an opaque empty 500,
// since the crash happens inside the transformers.js pipeline() call
// before this app's own error handling ever runs. VERCEL is set by
// the platform on every deployment (build and runtime alike), so it's
// a more precise signal than NODE_ENV=production for "which
// filesystem am I actually allowed to write to".
const DEFAULT_CACHE_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), "transformers-models")
  : "./.cache/transformers-models";
env.cacheDir = process.env.TRANSFORMERS_CACHE_DIR ?? DEFAULT_CACHE_DIR;

// Singleton/lazy-loaded model instance: the first call triggers
// download + load (slow, seconds), every subsequent call in the same
// process reuses this same promise (fast). Exported so tests can
// assert on memoization (same reference) without re-loading the model.
let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

export function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", MODEL_ID, { dtype: "q8" });
  }
  return extractorPromise;
}

async function embed(rawText: string, buildInput: (text: string) => string): Promise<number[]> {
  // Checked on the RAW text, before prefixing: "query: " or
  // "passage: " alone is never empty after trim(), so validating the
  // prefixed string would silently let "" / "   " through.
  if (!rawText.trim()) {
    throw new Error("embeddings: input text must not be empty or whitespace-only");
  }

  const extractor = await getExtractor();
  // pooling: 'mean' + normalize: true matches multilingual-e5-small's
  // documented requirement (average pooling over tokens, then L2
  // normalization) — verified against the model's official usage
  // instructions before implementation.
  const output = await extractor(buildInput(rawText), { pooling: "mean", normalize: true });
  const vector = Array.from(output.data as Float32Array);

  if (vector.length !== DIMENSION) {
    throw new Error(`embeddings: expected dimension ${DIMENSION}, got ${vector.length}`);
  }
  for (const value of vector) {
    if (!Number.isFinite(value)) {
      throw new Error("embeddings: model produced a non-finite value (NaN/Infinity)");
    }
  }

  return vector;
}

export class LocalE5EmbeddingProvider implements EmbeddingProvider {
  readonly dimension = DIMENSION;

  embedQuery(text: string): Promise<number[]> {
    return embed(text, queryInput);
  }

  embedPassage(text: string): Promise<number[]> {
    return embed(text, passageInput);
  }
}
