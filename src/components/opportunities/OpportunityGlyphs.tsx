// Shared glyphs for the Opportunities surfaces, in the same 24px /
// 1.8-stroke family as NavIcon. One semantic action = one icon:
//   SparkGlyph (BusinessAppShell) — Opportunities / Find An Opportunity
//   GoalGlyph                      — Business goals / Tell Findmi Your Goals
//   MomentGlyph                    — Add Moment (same pencil as QuickCreateMenu)

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
      <path d="M17 3a2.1 2.1 0 013 3L8.5 17.5 4 19l1.5-4.5L17 3z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
