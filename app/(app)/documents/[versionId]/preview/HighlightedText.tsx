"use client";

import { useEffect, useMemo, useRef } from "react";

// cleanText.ts collapses runs of whitespace before chunking, so a
// chunk's stored content rarely matches the raw file byte-for-byte
// (different line endings, double spaces, etc.). Escaping the chunk
// text for regex use and then replacing every whitespace run with
// `\s+` recovers a match against the ORIGINAL, unmodified file text
// without needing to re-run cleaning/chunking here. If no match is
// found (heavily reformatted content, or a chunk from a superseded
// extraction), this silently renders the plain text — never a crash,
// per the requirement.
function buildFuzzyMatcher(highlightText: string): RegExp | null {
  const trimmed = highlightText.trim();
  if (!trimmed) return null;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fuzzy = escaped.replace(/\s+/g, "\\s+");
  try {
    return new RegExp(fuzzy);
  } catch {
    return null;
  }
}

export function HighlightedText({ text, highlightText }: { text: string; highlightText: string | null }) {
  const markRef = useRef<HTMLElement>(null);

  const segments = useMemo(() => {
    if (!highlightText) return null;
    const matcher = buildFuzzyMatcher(highlightText);
    if (!matcher) return null;
    const match = matcher.exec(text);
    if (!match) return null;
    return {
      before: text.slice(0, match.index),
      match: match[0],
      after: text.slice(match.index + match[0].length),
    };
  }, [text, highlightText]);

  useEffect(() => {
    markRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [segments]);

  return (
    <div className="bg-white rounded-2xl border border-ink-100 p-4 sm:p-6">
      <pre className="whitespace-pre-wrap font-sans text-sm text-ink-900 leading-relaxed">
        {segments ? (
          <>
            {segments.before}
            <mark ref={markRef} className="bg-lime-200 rounded px-0.5">
              {segments.match}
            </mark>
            {segments.after}
          </>
        ) : (
          text
        )}
      </pre>
    </div>
  );
}
