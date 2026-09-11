import test from "node:test";
import assert from "node:assert/strict";
import { detectDocumentType, validateUploadedFile } from "../../../lib/ingestion/validate.ts";
import { IngestionError } from "../../../lib/ingestion/errors.ts";

test("detects PDF by magic bytes regardless of extension", () => {
  const data = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("rest")]);
  assert.equal(detectDocumentType("whatever.dat", data), "pdf");
});

test("detects TXT only when extension is .txt AND content looks like text", () => {
  assert.equal(detectDocumentType("notes.txt", Buffer.from("hello world")), "txt");
  assert.equal(detectDocumentType("notes.dat", Buffer.from("hello world")), null, "wrong extension must not be accepted as text");
});

test("rejects a binary file mislabeled .txt (contains a null byte)", () => {
  const data = Buffer.from([0x68, 0x69, 0x00, 0x62, 0x79, 0x65]);
  assert.equal(detectDocumentType("fake.txt", data), null);
});

test("7 — unsupported file type is rejected explicitly", () => {
  assert.throws(
    () => validateUploadedFile("archive.zip", Buffer.from([0x50, 0x4b, 0x03, 0x04])),
    (err: unknown) => err instanceof IngestionError && err.code === "UNSUPPORTED_FILE_TYPE"
  );
});

test("8 — empty file is rejected explicitly", () => {
  assert.throws(
    () => validateUploadedFile("empty.txt", Buffer.alloc(0)),
    (err: unknown) => err instanceof IngestionError && err.code === "EMPTY_FILE"
  );
});

test("oversized file is rejected explicitly", () => {
  const big = Buffer.alloc(21 * 1024 * 1024); // over the 20MB default
  assert.throws(
    () => validateUploadedFile("big.txt", big),
    (err: unknown) => err instanceof IngestionError && err.code === "FILE_TOO_LARGE"
  );
});

test("valid PDF and TXT pass validation", () => {
  const pdf = validateUploadedFile("doc.pdf", Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("x")]));
  assert.equal(pdf.type, "pdf");
  const txt = validateUploadedFile("doc.txt", Buffer.from("hello"));
  assert.equal(txt.type, "txt");
});
