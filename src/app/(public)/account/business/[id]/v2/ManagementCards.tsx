import Link from "next/link";
import CreateActionIcon from "./CreateActionIcon";
import { managementCards } from "./managementCardItems";

/** Business Home — Quick Access: the management destinations as compact
 * dashboard shortcuts (the reference screenshot's card language — rounded
 * card, light border, soft Aqua icon tile), each with two distinct actions:
 * "+ Add" (pale Aqua pill: create) and "View All" (neutral pill: manage
 * existing). The card body itself is NOT a link, so the two never blur.
 *
 * Phone: ONE horizontal swipe row (native touch scroll + snap; no dots, no
 * auto-rotate). Cards are 34% of the row — ~2.75 show, the next card's edge
 * signals more — and carry only icon, title and the two actions (short
 * visible labels "+ Add" / "View All"; the full "Add Event" / "View All
 * Events" is the accessible name). The row bleeds to the screen edges with
 * the shell's own 16px gutter (-mx-4 px-4 scroll-px-4).
 * Tablet (md+): the same compact cards as one row of six — no giant
 * cards. Wide desktop (xl+): the one-line description and full action
 * labels come back. */
export default function ManagementCards({ businessId }: { businessId: string }) {
  const cards = managementCards(businessId);
  return (
    <section aria-labelledby="quick-access-title">
      <div className="flex items-baseline gap-2">
        <h2 id="quick-access-title" className="font-display text-card-title font-bold text-primary">
          Quick Access
        </h2>
        <p className="min-w-0 truncate text-metadata text-muted">Create and manage what matters.</p>
      </div>
      <nav aria-label="Manage Your Business" className="mt-2">
        <ul className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto overscroll-x-contain px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] md:mx-0 md:grid md:snap-none md:grid-cols-6 md:gap-3 md:overflow-visible md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden">
          {cards.map((c) => (
            <li key={c.key} className="w-[34%] min-w-0 shrink-0 snap-start md:w-auto">
              <div className="flex h-full flex-col items-center rounded-2xl border border-black/[0.08] bg-white px-2 pb-2 pt-2.5 text-center xl:px-3 xl:pb-3 xl:pt-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-findmi-50 text-findmi-700 xl:h-10 xl:w-10">
                  {c.icon === "target" ? <TargetGlyph className="h-[18px] w-[18px] xl:h-5 xl:w-5" /> : <CreateActionIcon icon={c.icon} className="h-[18px] w-[18px] xl:h-5 xl:w-5" />}
                </span>
                <h3 className="mt-1.5 w-full truncate font-display text-[13px] font-bold leading-tight text-primary xl:text-card-title">{c.title}</h3>
                <p className="mt-0.5 hidden w-full truncate text-microcopy text-muted xl:block">{c.description}</p>
                <div className="mt-auto flex w-full flex-col gap-1 pt-2 xl:gap-1.5 xl:pt-2.5">
                  <Link
                    href={c.addHref}
                    aria-label={c.addLabel}
                    className="flex h-8 w-full items-center justify-center gap-0.5 rounded-full border border-findmi-200 bg-findmi-50 px-1.5 text-[12px] font-bold text-findmi-700 transition hover:border-findmi-300 hover:bg-findmi-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40 xl:h-9 xl:text-metadata"
                  >
                    <span aria-hidden="true" className="text-[15px] leading-none">
                      +
                    </span>
                    <span className="truncate xl:hidden">Add</span>
                    <span className="hidden truncate xl:inline">{c.addLabel}</span>
                  </Link>
                  <Link
                    href={c.viewHref}
                    aria-label={c.viewLabel}
                    className="flex h-8 w-full items-center justify-center rounded-full border border-black/[0.08] bg-black/[0.03] px-1.5 text-[12px] font-semibold text-secondary transition hover:border-black/15 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40 xl:h-9 xl:text-metadata"
                  >
                    <span className="truncate xl:hidden">View All</span>
                    <span className="hidden truncate xl:inline">{c.viewLabel}</span>
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </nav>
    </section>
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
