// Groq pricing — USD per 1M tokens, input/output separately.
// Source: https://console.groq.com/docs/model/openai/gpt-oss-120b
// (checked 2026-09-12). Update here if the deployed model changes or
// Groq revises pricing — there is no pricing API to read this from
// automatically.
//
// Only covers models actually used by this codebase (lib/llm/groq.ts
// hardcodes a single DEFAULT_MODEL, "openai/gpt-oss-120b", overridable
// via GROQ_MODEL — no multi-model routing exists). "mock-model" is the
// name the test-only LLM provider reports (see lib/llm/index.ts /
// setLlmProvider) and is listed explicitly so local test runs price
// at exactly $0, not silently fall through some other case.
export const MODEL_PRICING: Record<string, { inputPerMillion: number; outputPerMillion: number }> = {
  "openai/gpt-oss-120b": { inputPerMillion: 0.15, outputPerMillion: 0.60 },
  "mock-model": { inputPerMillion: 0, outputPerMillion: 0 },
};

/**
 * Returns 0 for a model not in MODEL_PRICING (never throws) — an
 * unrecognized model must never break the admin stats page, it just
 * can't be priced yet until this table is updated.
 */
export function estimateCostUsd(model: string | null, promptTokens: number | null, completionTokens: number | null): number {
  if (!model || !promptTokens || !completionTokens) return 0;
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (promptTokens * pricing.inputPerMillion + completionTokens * pricing.outputPerMillion) / 1_000_000;
}
