// Model-based tests (1,2,3,4,7,8) share ONE model load via the
// singleton in lib/embeddings/local-e5.ts — the first assertion in
// this file triggers download+load (seconds on a cold cache), every
// later call in this same process is fast. Prefix tests (5,6) and the
// memoization test (9) never touch the model at all — see
// lib/embeddings/prefixes.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { embedQuery, embedPassage, queryInput, passageInput, getExtractor } from "../../lib/embeddings/index.ts";

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  // Vectors are already L2-normalized (normalize: true), so the dot
  // product alone equals cosine similarity — no need to divide by norms.
  return dot;
}

test("5 — query embedding uses the 'query: ' prefix", () => {
  assert.equal(queryInput("congés payés"), "query: congés payés");
});

test("6 — document embedding uses the 'passage: ' prefix", () => {
  assert.equal(passageInput("congés payés"), "passage: congés payés");
});

test("8 — empty or whitespace-only input is rejected safely", async () => {
  await assert.rejects(() => embedQuery(""), /must not be empty/);
  await assert.rejects(() => embedQuery("   "), /must not be empty/);
  await assert.rejects(() => embedPassage(""), /must not be empty/);
});

test("9 — model initialization is memoized, not repeated", async () => {
  const first = getExtractor();
  const second = getExtractor();
  assert.equal(first, second, "getExtractor() must return the same in-flight/resolved promise both times");
  await first;
});

test("1,2,3,4 — embedding is generated, dimension 384, finite values only", async () => {
  const vector = await embedQuery("Quelle est la politique de congés ?");
  assert.ok(Array.isArray(vector));
  assert.equal(vector.length, 384);
  for (const value of vector) {
    assert.equal(typeof value, "number");
    assert.ok(Number.isFinite(value), `expected finite number, got ${value}`);
  }
});

test("7 — semantically similar texts score higher cosine similarity than unrelated ones", async () => {
  const base = await embedPassage("Le chat dort paisiblement sur le canapé du salon.");
  const similar = await embedPassage("Le félin se repose tranquillement sur le sofa du salon.");
  const unrelated = await embedPassage("Le marché boursier a fortement chuté aujourd'hui.");

  const simToSimilar = cosineSimilarity(base, similar);
  const simToUnrelated = cosineSimilarity(base, unrelated);

  assert.ok(
    simToSimilar > simToUnrelated,
    `expected similar-text cosine (${simToSimilar}) > unrelated-text cosine (${simToUnrelated})`
  );
});
