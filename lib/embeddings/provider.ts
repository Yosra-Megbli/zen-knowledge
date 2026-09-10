import { LocalE5EmbeddingProvider } from "./local-e5.ts";
import type { EmbeddingProvider } from "./types.ts";

// Single provider for now (local, free, CPU). Swapping to a different
// provider later means adding a new class implementing EmbeddingProvider
// and changing this one line — nothing else in the codebase depends on
// LocalE5EmbeddingProvider directly (see index.ts).
export const embeddingProvider: EmbeddingProvider = new LocalE5EmbeddingProvider();
