// Small geometric multicolor mark, in the same visual family as the
// ZEN Group recruitment portal's own logo (a grid of colored shapes
// next to a wordmark) — an original mark for this product, not a
// reproduction of ZEN Group's actual logo file/trademark.
export function LogoMark({ className = "w-7 h-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden="true">
      <rect x="1" y="1" width="12" height="12" rx="3" fill="#C7EB3D" />
      <rect x="15" y="1" width="12" height="12" rx="3" fill="#12160F" stroke="white" strokeWidth="1.25" />
      <rect x="1" y="15" width="12" height="12" rx="3" fill="#12160F" stroke="white" strokeWidth="1.25" />
      <rect x="15" y="15" width="12" height="12" rx="3" fill="#C7EB3D" />
    </svg>
  );
}

export function Logo({ dark = false, className = "" }: { dark?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-display font-semibold tracking-tight ${dark ? "text-white" : "text-ink-950"} ${className}`}>
      <LogoMark />
      ZEN Knowledge
    </span>
  );
}
