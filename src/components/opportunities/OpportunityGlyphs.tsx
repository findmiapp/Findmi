// Shared glyphs for the Opportunities surfaces, in the same 24px /
// 1.8-stroke family as NavIcon. One semantic action = one icon:
//   SparkGlyph (BusinessAppShell) — Opportunities / Find An Opportunity
//   GoalGlyph                      — Business goals / Tell Findmi Your Goals
//   MomentGlyph                    — Add Moment: the canonical Moments photo (NavIcon "moments"), never a pencil

export function GoalGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M5 21V4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M5 4.5h11.5l-2.2 3.75L16.5 12H5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

export function MomentGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="3.5" y="5" width="17" height="14.5" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 16.5l4.6-4.2a1.2 1.2 0 011.6 0l3.3 3 2.2-2a1.2 1.2 0 011.6 0l3.7 3.4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="15.5" cy="9.6" r="1.6" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
