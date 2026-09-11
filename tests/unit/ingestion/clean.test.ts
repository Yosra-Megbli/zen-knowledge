import test from "node:test";
import assert from "node:assert/strict";
import { cleanText } from "../../../lib/ingestion/clean/cleanText.ts";

test("normalizes CRLF to LF", () => {
  assert.equal(cleanText("a\r\nb\r\nc"), "a\nb\nc");
});

test("collapses runs of spaces/tabs but preserves newlines", () => {
  assert.equal(cleanText("a    b\t\tc\nd"), "a b c\nd");
});

test("collapses 3+ blank lines to a single blank line", () => {
  assert.equal(cleanText("a\n\n\n\n\nb"), "a\n\nb");
});

test("strips non-printable control characters but keeps content", () => {
  const withArtifacts = "hello\x00\x01 world\x0Bfoo";
  assert.equal(cleanText(withArtifacts), "hello world foo");
});

test("preserves meaningful punctuation and does not over-clean", () => {
  const input = "Section 1: Overview — see (a), (b) & (c). 100% clear?";
  assert.equal(cleanText(input), input);
});

test("trims leading/trailing whitespace", () => {
  assert.equal(cleanText("   \n  hello  \n  "), "hello");
});
