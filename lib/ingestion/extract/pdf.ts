import { PDFParse } from "pdf-parse";
import { IngestionError } from "../errors.ts";
import type { ExtractionResult } from "./types.ts";

// Threshold below which a "successfully parsed" PDF is treated as
// having no usable text — distinguishes a genuine (if short) text
// document from a scanned/image-only PDF whose text layer is empty or
// contains only stray whitespace/artifacts. Deliberately small: this
// phase must not reject short-but-real documents, only clearly empty
// ones. OCR for scanned PDFs is explicitly out of scope (see README).
const MIN_EXTRACTABLE_CHARACTERS = 10;

export async function extractPdf(data: Buffer): Promise<ExtractionResult> {
  let parser: PDFParse;
  try {
    parser = new PDFParse({ data });
  } catch (err) {
    throw new IngestionError("CORRUPTED_FILE", `PDF could not be opened: ${(err as Error).message}`);
  }

  try {
    const result = await parser.getText();
    const pages = result.pages.map((p) => ({ pageNumber: p.num, text: p.text }));

    const totalChars = pages.reduce((sum, p) => sum + p.text.trim().length, 0);
    if (totalChars < MIN_EXTRACTABLE_CHARACTERS) {
      throw new IngestionError(
        "NO_EXTRACTABLE_TEXT",
        "PDF contains no usable text layer (likely a scanned/image-only PDF). OCR is out of scope for this phase."
      );
    }

    return { pages };
  } catch (err) {
    if (err instanceof IngestionError) throw err;
    throw new IngestionError("CORRUPTED_FILE", `PDF text extraction failed: ${(err as Error).message}`);
  } finally {
    await parser.destroy();
  }
}
