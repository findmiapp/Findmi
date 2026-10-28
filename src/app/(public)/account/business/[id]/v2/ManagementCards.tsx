import Link from "next/link";
import CreateActionIcon from "./CreateActionIcon";
import { managementCards } from "./managementCardItems";

/** Business Home — management destinations (the reference screenshot's
 * card language): a rounded card with a subtle light-gray border, a soft
 * Aqua icon tile, title + one short line, then two visually distinct
 * actions — "+ Add …" (pale Aqua pill: create) and "View All …" (neutral
 * pill: manage existing). The whole card body is NOT a link, so the two
 * actions never blur together.
 *
 * Phone: ONE horizontal, swipeable row (native touch scroll + snap, no
 * dots, no auto-rotate) so the cards don't push the dashboard below the
 * fold. Each card is 72% of the row — ~1.35 cards show, the next card's
 * edge signals there's more. The row bleeds to the screen edges with the
 * shell's own 16px gutter (-mx-4 px-4 scroll-px-4), the same pattern as
 * Discovery tiles. Tablet: a 3-column grid; desktop: one row of six. */
export default function ManagementCards({ businessId }: { businessId: string }) {
  const cards = managementCards(businessId);
  return (
    <nav aria-label="Manage Your Business">
      <ul className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto overscroll-x-contain px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:mx-0 sm:grid sm:snap-none sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-6 [&::-webkit-scrollbar]:hidden">
        {cards.map((c) => (
          <li key={c.key} className="w-[72%] min-w-0 shrink-0 snap-start sm:w-auto">
            <section aria-labelledby={`mc-${c.key}`} className="flex h-full flex-col items-center rounded-2xl border border-black/[0.08] bg-white px-2.5 pb-2.5 pt-3.5 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-findmi-50 text-findmi-700">
                {c.icon === "target" ? <TargetGlyph className="h-6 w-6" /> : <CreateActionIcon icon={c.icon} className="h-6 w-6" />}
              </span>
              <h2 id={`mc-${c.key}`} className="mt-2 font-display text-card-title font-bold text-primary">
                {c.title}
              </h2>
              <p className="mt-0.5 line-clamp-2 min-h-[2.5em] text-microcopy leading-snug text-muted">{c.description}</p>
              <div className="mt-auto flex w-full flex-col gap-1.5 pt-2.5">
                <Link
                  href={c.addHref}
                  className="flex h-9 w-full items-center justify-center gap-1 rounded-full border border-findmi-200 bg-findmi-50 px-2 text-metadata font-bold text-findmi-700 transition hover:border-findmi-300 hover:bg-findmi-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
                >
                  <span aria-hidden="true" className="text-base leading-none">
                    +
                  </span>
                  <span className="truncate">{c.addLabel}</span>
                </Link>
                <Link
                  href={c.viewHref}
                  className="flex h-9 w-full items-center justify-center rounded-full border border-black/[0.08] bg-black/[0.03] px-2 text-metadata font-semibold text-secondary transition hover:border-black/15 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
                >
                  <span className="truncate">{c.viewLabel}</span>
                </Link>
              </div>
            </section>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** 24px / 1.8-stroke family, same as NavIcon. */
function TargetGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}
