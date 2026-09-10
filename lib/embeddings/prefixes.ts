// multilingual-e5-small requires "query: " / "passage: " prefixes for
// asymmetric retrieval (verified against the model's official usage
// instructions). Kept as pure, model-independent functions so the
// prefix contract can be unit-tested without loading the model —
// see tests/unit/embeddings.test.ts.
export function queryInput(text: string): string {
  return `query: ${text}`;
}

export function passageInput(text: string): string {
  return `passage: ${text}`;
}
