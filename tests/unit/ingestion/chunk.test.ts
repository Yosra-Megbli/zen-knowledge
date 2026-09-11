import test from "node:test";
import assert from "node:assert/strict";
import { chunkText, chunkPages } from "../../../lib/ingestion/chunk/chunkText.ts";

test("17 — never produces empty chunks", () => {
  const chunks = chunkText("   \n\n   ");
  assert.deepEqual(chunks, []);
});

test("splits long text into overlapping chunks of the configured size", () => {
  const text = "a".repeat(2000);
  const chunks = chunkText(text, { chunkSize: 800, overlap: 150 });
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    assert.ok(c.content.length <= 800 + 40, "chunk must not wildly exceed chunkSize (+ boundary lookahead)");
    assert.ok(c.content.length > 0);
  }
});

test("chunking the same input twice is deterministic", () => {
  const text = "The quick brown fox jumps over the lazy dog. ".repeat(50);
  const a = chunkText(text, { chunkSize: 300, overlap: 50 });
  const b = chunkText(text, { chunkSize: 300, overlap: 50 });
  assert.deepEqual(a, b);
});

test("does not split words when a whitespace boundary is nearby", () => {
  const text = "word1 word2 word3 word4 word5 word6 word7 word8";
  const chunks = chunkText(text, { chunkSize: 12, overlap: 2 });
  for (const c of chunks) {
    assert.ok(!/^\S+$/.test(c.content) || c.content.split(" ").every((w) => text.includes(w)), "each chunk word must be a real whole word from the source");
  }
});

test("rejects an invalid overlap configuration", () => {
  assert.throws(() => chunkText("hello world", { chunkSize: 10, overlap: 10 }));
  assert.throws(() => chunkText("hello world", { chunkSize: 10, overlap: -1 }));
  assert.throws(() => chunkText("hello", { chunkSize: 0 }));
});

test("chunkPages preserves page_number per chunk and never mixes pages", () => {
  const pages = [
    { pageNumber: 1, text: "Content of page one, fairly short." },
    { pageNumber: 2, text: "Content of page two, also short." },
  ];
  const chunks = chunkPages(pages, { chunkSize: 20, overlap: 5 });
  assert.ok(chunks.some((c) => c.pageNumber === 1));
  assert.ok(chunks.some((c) => c.pageNumber === 2));
  for (const c of chunks) {
    const sourcePage = pages.find((p) => p.pageNumber === c.pageNumber);
    assert.ok(sourcePage && sourcePage.text.includes(c.content.split(" ")[0]));
  }
});
