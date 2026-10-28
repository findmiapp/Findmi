import { VISIBILITY_LABELS, type PublicVisibility } from "@/lib/profile-visibility";

/** LIVE ON PROFILE / PENDING REVIEW / NOT SHOWN ON PROFILE — the one chip
 * every manager surface uses for an outbound profile element's visibility
 * (lib/profile-visibility.ts). Same pill language as the Manager's status
 * chips: Aqua tint for live, amber for in review, neutral for not shown. */
const TONE: Record<PublicVisibility, string> = {
  live: "border-findmi-200 bg-findmi-50 text-findmi-700",
  pending_review: "border-amber-200 bg-amber-50 text-amber-800",
  hidden: "border-black/10 bg-black/[0.04] text-muted",
};

export default function VisibilityChip({ status, className = "" }: { status: PublicVisibility; className?: string }) {
  return (
    <span className={`inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 text-microcopy font-bold uppercase tracking-wide ${TONE[status]} ${className}`}>
      {VISIBILITY_LABELS[status]}
    </span>
  );
}
