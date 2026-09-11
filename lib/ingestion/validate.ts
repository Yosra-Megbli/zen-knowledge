import { IngestionError } from "./errors.ts";

export type SupportedDocumentType = "pdf" | "txt";

const MAX_FILE_SIZE_BYTES = Number(process.env.INGESTION_MAX_FILE_SIZE_BYTES ?? 20 * 1024 * 1024); // 20MB default

const PDF_MAGIC = Buffer.from("%PDF-", "utf8");

/**
 * Server-side file type detection. Deliberately ignores the
 * client-supplied MIME type/extension as the source of truth — only
 * the file's own magic bytes decide what it actually is. TXT has no
 * reliable magic bytes, so it is the fallback ONLY when the extension
 * says .txt AND the content contains no PDF signature and is
 * decodable as text (see isLikelyText).
 */
export function detectDocumentType(fileName: string, data: Buffer): SupportedDocumentType | null {
  if (data.subarray(0, 5).equals(PDF_MAGIC)) {
    return "pdf";
  }

  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "txt" && isLikelyText(data)) {
    return "txt";
  }

  return null;
}

function isLikelyText(data: Buffer): boolean {
  if (data.length === 0) return false;
  // A null byte essentially never appears in genuine text content;
  // its presence is a strong signal of a binary file mislabeled .txt.
  const sample = data.subarray(0, Math.min(data.length, 8000));
  return !sample.includes(0);
}

export interface ValidatedFile {
  type: SupportedDocumentType;
  data: Buffer;
  fileName: string;
}

/**
 * Throws IngestionError for anything unsafe/unsupported. Never trusts
 * the client-supplied MIME type alone (see detectDocumentType).
 */
export function validateUploadedFile(fileName: string, data: Buffer): ValidatedFile {
  if (data.length === 0) {
    throw new IngestionError("EMPTY_FILE", "Uploaded file is empty.");
  }
  if (data.length > MAX_FILE_SIZE_BYTES) {
    throw new IngestionError(
      "FILE_TOO_LARGE",
      `Uploaded file exceeds the maximum allowed size of ${MAX_FILE_SIZE_BYTES} bytes.`
    );
  }

  const type = detectDocumentType(fileName, data);
  if (!type) {
    throw new IngestionError(
      "UNSUPPORTED_FILE_TYPE",
      "Unsupported file type. Only PDF and TXT are accepted in this phase."
    );
  }

  return { type, data, fileName };
}
