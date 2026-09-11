export type { LlmProvider, LlmRequest, LlmResponse, LlmUsage, LlmMessage, LlmErrorCode } from "./types.ts";
export { LlmError } from "./types.ts";
export { GroqProvider } from "./groq.ts";

import type { LlmProvider } from "./types.ts";
import { GroqProvider } from "./groq.ts";

// Lazy singleton — constructed only when first needed (i.e. on the
// first real RAG request), never at module load time. This avoids
// throwing CONFIGURATION_ERROR during build/test when GROQ_API_KEY is
// absent, while still failing loudly at runtime if it is missing.
let _provider: LlmProvider | null = null;

export function getLlmProvider(): LlmProvider {
  if (!_provider) {
    _provider = new GroqProvider();
  }
  return _provider;
}

/** Inject a test double. Call with null to reset to the real provider. */
export function setLlmProvider(p: LlmProvider | null): void {
  _provider = p;
}
