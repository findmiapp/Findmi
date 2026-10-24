import Link from "next/link";
import { MOMENTS_PAGE_MODES, MOMENTS_PAGE_MODE_LABELS, momentsModeHref, type MomentFeedMode, type MomentsPageMode } from "@/lib/moment-filters";

/** /moments' three modes — Explore · For You · My Moments — as one
 * segmented control. Explore ↔ For You switch in place over the cards
 * already loaded (`onSelect`, from MomentsDiscovery); My Moments is a real
 * navigation (its own owner-scoped read), so it is always a link — Back
 * returns to where the person was. Without `onSelect` (on My Moments
 * itself) every mode is a link. No hooks: safe in server components. */
export default function MomentsModeTabs({ active, onSelect }: { active: MomentsPageMode; onSelect?: (mode: MomentFeedMode) => void }) {
  const cls = (on: boolean) =>
    `flex h-8 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40 ${
      on ? "bg-white text-primary shadow-sm" : "text-muted hover:text-primary"
    }`;
  return (
    <nav aria-label="Moments" className="inline-flex max-w-full rounded-full bg-black/[0.05] p-1">
      {MOMENTS_PAGE_MODES.map((m) => {
        const on = m === active;
        if (onSelect && m !== "my-moments") {
          return (
            <button key={m} type="button" aria-current={on ? "page" : undefined} onClick={() => onSelect(m)} className={cls(on)}>
              {MOMENTS_PAGE_MODE_LABELS[m]}
            </button>
          );
        }
        return (
          <Link key={m} href={momentsModeHref(m)} aria-current={on ? "page" : undefined} className={cls(on)}>
            {MOMENTS_PAGE_MODE_LABELS[m]}
          </Link>
        );
      })}
    </nav>
  );
}
