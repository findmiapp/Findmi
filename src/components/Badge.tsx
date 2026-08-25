// Split into two independent badges on purpose (Part 3 of the founder
// edit-mode/launch-fixes pass): verified and founding_member are
// unrelated pieces of business data — a business can be either, both, or
// neither, and neither one's visibility should ever gate the other's
// (they previously shared one conditional + one badge that could only
// show a single label, which is what let founding_member silently stop
// rendering anything once verified was also false).
function BadgeShell({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-1 text-[11px] font-semibold text-white">
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
        <path
          fillRule="evenodd"
          d="M10 1.5l2.1 1.53 2.6-.1.8 2.47 2.47.8-.1 2.6L19.4 10l-1.53 2.1.1 2.6-2.47.8-.8 2.47-2.6-.1L10 19.4l-2.1-1.53-2.6.1-.8-2.47-2.47-.8.1-2.6L.6 10l1.53-2.1-.1-2.6 2.47-.8.8-2.47 2.6.1L10 1.5zm-.94 11.94l4.95-4.95-1.06-1.06-3.89 3.89-1.77-1.77-1.06 1.06 2.83 2.83z"
          clipRule="evenodd"
        />
      </svg>
      {children}
    </span>
  );
}

export function VerifiedBadge() {
  return <BadgeShell>Verified</BadgeShell>;
}

export function FoundingMemberBadge() {
  return <BadgeShell>Founding Member</BadgeShell>;
}

// Editorial curation flag (businesses.is_featured) — independent of both
// badges above for the exact same reason they're independent of each
// other: a business can be Featured with or without also being Verified
// or a Founding Member (Business Profile V2, Part 23).
export function FeaturedBadge() {
  return <BadgeShell>Featured</BadgeShell>;
}

export function CategoryPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-black/[0.04] px-2.5 py-1 text-xs font-medium text-ink/70">
      {children}
    </span>
  );
}
