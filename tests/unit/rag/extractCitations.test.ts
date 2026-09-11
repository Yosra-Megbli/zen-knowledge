// extractCitations() maps [SOURCE n] references in an LLM answer back
// to real chunk metadata. Found via live testing against the real Groq
// provider (gpt-oss-120b): the model does not reliably emit plain ASCII
// "[SOURCE n]" — it sometimes uses fullwidth CJK brackets (U+3010/3011)
// or inserts a zero-width character right after the opening ASCII
// bracket, silently dropping every citation from the ASCII-only regex.
// The integration tests in tests/integration/rag/answer.test.ts always
// use a mock LLM provider with clean ASCII output, so they never
// exercised this path.
import test from "node:test";
import assert from "node:assert/strict";
import { extractCitations } from "../../../lib/rag/answerQuestion.ts";
import type { SourceBlock } from "../../../lib/rag/buildPrompt.ts";
import type { RetrievedChunk } from "../../../lib/rag/retrieveAuthorizedChunks.ts";

function makeSource(index: number): SourceBlock {
  return {
    index,
    chunkId: `chunk-${index}`,
    documentId: `doc-${index}`,
    documentVersionId: `version-${index}`,
    documentTitle: `Document ${index}`,
    versionNumber: 1,
    pageNumber: null,
    content: `content ${index}`,
  };
}

function makeChunk(index: number): RetrievedChunk {
  return {
    chunkId: `chunk-${index}`,
    documentId: `doc-${index}`,
    documentVersionId: `version-${index}`,
    documentTitle: `Document ${index}`,
    versionNumber: 1,
    pageNumber: null,
    content: `content ${index}`,
    similarity: 0.9,
  };
}

const sources = [makeSource(1), makeSource(2)];
const chunks = [makeChunk(1), makeChunk(2)];

test("plain ASCII [SOURCE n] is extracted", () => {
  const citations = extractCitations("The answer is X [SOURCE 1].", sources, chunks);
  assert.deepEqual(citations.map((c) => c.sourceIndex), [1]);
});

test("fullwidth CJK brackets 【SOURCE n】 are extracted (observed from the real Groq/gpt-oss-120b provider)", () => {
  const citations = extractCitations("The answer is X 【SOURCE 1】.", sources, chunks);
  assert.deepEqual(citations.map((c) => c.sourceIndex), [1]);
});

test("a zero-width space right after the opening bracket does not break extraction", () => {
  const citations = extractCitations("The answer is X [​SOURCE 1].", sources, chunks);
  assert.deepEqual(citations.map((c) => c.sourceIndex), [1]);
});

test("multiple citations across mixed bracket styles are all extracted", () => {
  const citations = extractCitations(
    "X [SOURCE 1] and Y 【SOURCE 2】.",
    sources,
    chunks
  );
  assert.deepEqual(new Set(citations.map((c) => c.sourceIndex)), new Set([1, 2]));
});

test("an out-of-range fabricated source index is still silently dropped", () => {
  const citations = extractCitations("X 【SOURCE 99】.", sources, chunks);
  assert.deepEqual(citations, []);
});

test("citation metadata matches the real source, not just the index", () => {
  const citations = extractCitations("X [SOURCE 2].", sources, chunks);
  assert.equal(citations.length, 1);
  assert.equal(citations[0].documentId, "doc-2");
  assert.equal(citations[0].chunkId, "chunk-2");
});
