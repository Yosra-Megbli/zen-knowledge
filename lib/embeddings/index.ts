export type { EmbeddingProvider } from "./types.ts";
export { queryInput, passageInput } from "./prefixes.ts";
export { embeddingProvider } from "./provider.ts";
export { getExtractor } from "./local-e5.ts";

import { embeddingProvider } from "./provider.ts";

export function embedQuery(text: string): Promise<number[]> {
  return embeddingProvider.embedQuery(text);
}

export function embedPassage(text: string): Promise<number[]> {
  return embeddingProvider.embedPassage(text);
}
