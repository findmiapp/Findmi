// Three independent business badges (Founding Member / Verified /
// Featured) — a business can show any combination, including all three or
// none; showing one must never gate another (Part 3 of the founder edit-
// mode/launch-fixes pass, reaffirmed by Business Profile V2 Part 23).
//
// UI cleanup pass, item 3: they used to share one identical black-pill
// shell and visually competed as three equally-loud badges. Now each
// carries its own weight in the hierarchy instead: Founding Member stays
// the strongest (dark/solid — it's the paid, historical credential),
// Verified is deliberately the quietest (a soft outline — trust signal,
// not a headline), Featured uses restrained FindMi Aqua (editorial
// curation, distinct from both).

export function FoundingMemberBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-1 text-[11px] font-semibold text-white">
      <StarGlyph className="h-3 w-3" />
      Founding Member
    </span>
  );
}

export function VerifiedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-black/15 bg-white px-2.5 py-1 text-[11px] font-semibold text-ink/60">
      <CheckGlyph className="h-3 w-3" />
      Verified
    </span>
  );
}

// Editorial curation flag (businesses.is_featured).
export function FeaturedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-findmi px-2.5 py-1 text-[11px] font-semibold text-white">
      <StarGlyph className="h-3 w-3" />
      Featured
    </span>
  );
}

export function CategoryPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-black/[0.04] px-2.5 py-1 text-xs font-medium text-ink/70">
      {children}
    </span>
  );
}

function StarGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path
        fillRule="evenodd"
        d="M10 1.5l2.1 1.53 2.6-.1.8 2.47 2.47.8-.1 2.6L19.4 10l-1.53 2.1.1 2.6-2.47.8-.8 2.47-2.6-.1L10 19.4l-2.1-1.53-2.6.1-.8-2.47-2.47-.8.1-2.6L.6 10l1.53-2.1-.1-2.6 2.47-.8.8-2.47 2.6.1L10 1.5zm-.94 11.94l4.95-4.95-1.06-1.06-3.89 3.89-1.77-1.77-1.06 1.06 2.83 2.83z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function CheckGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className}>
      <path
        d="M4 10.5l3.5 3.5L16 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
