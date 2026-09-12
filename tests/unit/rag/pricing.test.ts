import test from "node:test";
import assert from "node:assert/strict";
import { estimateCostUsd, MODEL_PRICING } from "../../../lib/rag/pricing.ts";

test("known model: cost is (promptTokens * input + completionTokens * output) / 1e6", () => {
  const cost = estimateCostUsd("openai/gpt-oss-120b", 1_000_000, 1_000_000);
  const expected = MODEL_PRICING["openai/gpt-oss-120b"].inputPerMillion + MODEL_PRICING["openai/gpt-oss-120b"].outputPerMillion;
  assert.equal(cost, expected);
});

test("unknown model never throws — prices at $0", () => {
  assert.equal(estimateCostUsd("some-model-not-in-the-table", 1000, 1000), 0);
});

test("mock-model (test-only LLM provider) always prices at $0", () => {
  assert.equal(estimateCostUsd("mock-model", 1_000_000, 1_000_000), 0);
});

test("null model or missing token counts price at $0, never throw/NaN", () => {
  assert.equal(estimateCostUsd(null, 100, 100), 0);
  assert.equal(estimateCostUsd("openai/gpt-oss-120b", null, 100), 0);
  assert.equal(estimateCostUsd("openai/gpt-oss-120b", 100, null), 0);
  assert.equal(estimateCostUsd("openai/gpt-oss-120b", 0, 0), 0);
});
