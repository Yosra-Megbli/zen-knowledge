import type { SupportedDocumentType } from "../validate.ts";
import { extractPdf } from "./pdf.ts";
import { extractTxt } from "./txt.ts";
import type { ExtractionResult } from "./types.ts";

export type { ExtractedPage, ExtractionResult } from "./types.ts";

export async function extractText(type: SupportedDocumentType, data: Buffer): Promise<ExtractionResult> {
  switch (type) {
    case "pdf":
      return extractPdf(data);
    case "txt":
      return extractTxt(data);
  }
}
