import { IngestionError } from "../errors.ts";
import type { ExtractionResult } from "./types.ts";

// TXT has no concept of pages — treated as a single page 1 so callers
// (chunking, citations) don't need a special case.
export async function extractTxt(data: Buffer): Promise<ExtractionResult> {
  const text = data.toString("utf8");
  if (!text.trim()) {
    throw new IngestionError("NO_EXTRACTABLE_TEXT", "Text file contains no usable content.");
  }
  return { pages: [{ pageNumber: 1, text }] };
}
