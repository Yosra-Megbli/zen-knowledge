// Generates small deterministic binary test fixtures (committed
// alongside this script) so tests never depend on external/downloaded
// files or real confidential documents. Re-run with:
//   node tests/fixtures/ingestion/generate.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

function buildMinimalPdf({ text }) {
  const hasText = Boolean(text);
  const contentStream = hasText
    ? `BT /F1 18 Tf 72 700 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`
    : ""; // a valid page with an empty content stream: no text objects at all

  const objects = [];
  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`); // 1
  objects.push(`<< /Type /Pages /Kids [3 0 R] /Count 1 >>`); // 2
  objects.push(
    `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>`
  ); // 3
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`); // 4
  objects.push(`<< /Length ${Buffer.byteLength(contentStream, "utf8")} >>\nstream\n${contentStream}\nendstream`); // 5

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf, "utf8");
  const count = objects.length + 1;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += xref;
  pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
}

writeFileSync(
  path.join(dir, "valid.pdf"),
  buildMinimalPdf({ text: "This is a test document for ingestion pipeline testing." })
);

writeFileSync(path.join(dir, "empty-text.pdf"), buildMinimalPdf({ text: "" }));

writeFileSync(path.join(dir, "valid.txt"), "This is a small valid text document used by ingestion tests.\n");

writeFileSync(path.join(dir, "empty.txt"), "");

// Starts with the PDF magic bytes (passes a naive header check) but the
// rest is not valid PDF structure at all — must fail parsing cleanly.
writeFileSync(path.join(dir, "corrupted.pdf"), Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from([0, 1, 2, 3, 255, 254, 253, 0, 0, 0])]));

// Disallowed extension/type entirely.
writeFileSync(path.join(dir, "unsupported.bin"), Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]));

console.log("Fixtures generated in", dir);
