// Deterministic, conservative cleaning — normalizes whitespace and
// strips non-printable extraction artifacts (common from PDF text
// layers) without touching punctuation, casing, or wording. Never
// rewrites or summarizes content, and never calls an external service.
export function cleanText(raw: string): string {
  let text = raw;

  // Normalize line endings.
  text = text.replace(/\r\n?/g, "\n");

  // Replace (not remove!) non-printable / control characters with a
  // space, keeping \n and \t. These occasionally appear from PDF text
  // layers around ligatures or broken glyphs, sometimes standing in
  // for a genuine word boundary — deleting them outright risks gluing
  // two separate words together (e.g. "world\x0Bfoo" -> "worldfoo",
  // a real semantic corruption caught by this module's own tests).
  // The whitespace-collapsing step below cleans up any resulting
  // double spaces.
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");

  // Collapse runs of spaces/tabs (but not newlines) to a single space.
  text = text.replace(/[ \t]+/g, " ");

  // Trim trailing whitespace on each line.
  text = text.replace(/[ \t]+\n/g, "\n");

  // Collapse 3+ consecutive blank lines to a single blank line,
  // preserving paragraph/heading separation without excessive gaps.
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}
