// Deterministic, character-based chunking. Character counting (rather
// than tokenization) keeps this dependency-free and fully predictable
// — no tokenizer version to drift, same input always yields the same
// chunks. Defaults are configurable via env, not hardcoded, and are
// deliberately unoptimized for this phase (see README "Chunking
// strategy" for the reasoning): 800 characters keeps each chunk small
// enough for precise citations while staying well under any
// embedding model's context limit; 150 characters of overlap (~19%)
// avoids losing a sentence that straddles a chunk boundary.
const DEFAULT_CHUNK_SIZE = Number(process.env.INGESTION_CHUNK_SIZE ?? 800);
const DEFAULT_CHUNK_OVERLAP = Number(process.env.INGESTION_CHUNK_OVERLAP ?? 150);

// How far past the target boundary this function will look for a
// whitespace character to snap to, so words are not split mid-way.
// Falls back to a hard cut if none is found in range (e.g. one very
// long unbroken token, such as a URL).
const BOUNDARY_LOOKAHEAD = 40;

export interface ChunkOptions {
  chunkSize?: number;
  overlap?: number;
}

export interface TextChunk {
  content: string;
}

export function chunkText(text: string, options: ChunkOptions = {}): TextChunk[] {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = options.overlap ?? DEFAULT_CHUNK_OVERLAP;
  if (chunkSize <= 0) throw new Error("chunkText: chunkSize must be positive");
  if (overlap < 0 || overlap >= chunkSize) {
    throw new Error("chunkText: overlap must be >= 0 and strictly less than chunkSize");
  }

  const trimmed = text.trim();
  if (!trimmed) return [];

  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < trimmed.length) {
    let end = Math.min(start + chunkSize, trimmed.length);
    if (end < trimmed.length) {
      const lookahead = trimmed.slice(end, Math.min(end + BOUNDARY_LOOKAHEAD, trimmed.length));
      const wsIndex = lookahead.search(/\s/);
      if (wsIndex !== -1) end += wsIndex;
    }

    const slice = trimmed.slice(start, end).trim();
    if (slice.length > 0) {
      // Never persist an empty chunk (requirement: "avoid empty chunks").
      chunks.push({ content: slice });
    }

    if (end >= trimmed.length) break;
    start = end - overlap;
  }

  return chunks;
}

export interface PageInput {
  pageNumber: number;
  text: string;
}

export interface PageChunk {
  content: string;
  pageNumber: number | null;
}

/**
 * Chunks each page independently so page_number stays accurate per
 * chunk (a chunk never spans two pages) — required for citations in a
 * later phase.
 */
export function chunkPages(pages: PageInput[], options: ChunkOptions = {}): PageChunk[] {
  const result: PageChunk[] = [];
  for (const page of pages) {
    for (const chunk of chunkText(page.text, options)) {
      result.push({ content: chunk.content, pageNumber: page.pageNumber });
    }
  }
  return result;
}
