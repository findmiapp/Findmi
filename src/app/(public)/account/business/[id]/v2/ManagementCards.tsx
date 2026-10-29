import Link from "next/link";
import CreateActionIcon from "./CreateActionIcon";
import { managementCards } from "./managementCardItems";

/** Business Home → CREATE & MANAGE: the management destinations as compact
 * LANDSCAPE cards — icon + title, a short line saying what lives there, and two
 * distinct actions on one row: "+ Add" (pale Aqua pill: the canonical creation
 * flow) and "View All" (neutral pill: manage existing). The card body itself is
 * NOT a link, so the two never blur; the full "Add Event" / "View All Events"
 * is each action's accessible name.
 *
 * Phone: ONE native horizontal swipe rail (snap, no dots, no arrows). Cards are
 * 44% of the row — ~2.3 show at 390px, and the next card's edge says the rail
 * scrolls. It bleeds to the screen edges with the shell's own 16px gutter
 * (-mx-4 px-4 scroll-px-4). Keyboard: every action is a focusable link, and
 * focusing one scrolls it into view. Tablet (md+): a 3-column grid; wide
 * desktop (xl+): all six in one row. */
export default function ManagementCards({ businessId }: { businessId: string }) {
  const cards = managementCards(businessId);
  return (
    <section aria-labelledby="create-manage-title">
      <h2 id="create-manage-title" className="font-display text-section-title font-bold text-primary">
        Create &amp; Manage
      </h2>
      <nav aria-label="Create And Manage" className="mt-2">
        <ul className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto overscroll-x-contain px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] md:mx-0 md:grid md:snap-none md:grid-cols-3 md:gap-3 md:overflow-visible md:px-0 md:pb-0 xl:grid-cols-6 [&::-webkit-scrollbar]:hidden">
          {cards.map((c) => (
            <li key={c.key} data-create-manage-card className="w-[44%] min-w-0 shrink-0 snap-start sm:w-[30%] md:w-auto">
              <div className="flex h-full flex-col rounded-2xl border border-black/[0.08] bg-white p-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-findmi-50 text-findmi-700">
                    {c.icon === "target" ? <TargetGlyph className="h-4 w-4" /> : <CreateActionIcon icon={c.icon} className="h-4 w-4" />}
                  </span>
                  <h3 className="min-w-0 truncate font-display text-[14px] font-bold leading-tight text-primary">{c.title}</h3>
                </div>
                <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted">{c.description}</p>
                <div className="mt-auto flex gap-1.5 pt-2">
                  <Link
                    href={c.addHref}
                    aria-label={c.addLabel}
                    className="flex h-8 min-w-0 flex-1 items-center justify-center gap-0.5 rounded-full border border-findmi-200 bg-findmi-50 px-1 text-[12px] font-bold text-findmi-700 transition hover:border-findmi-300 hover:bg-findmi-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
                  >
                    <span aria-hidden="true" className="text-[14px] leading-none">
                      +
                    </span>
                    <span className="truncate">Add</span>
                  </Link>
                  <Link
                    href={c.viewHref}
                    aria-label={c.viewLabel}
                    className="flex h-8 min-w-0 flex-1 items-center justify-center rounded-full border border-black/[0.08] bg-black/[0.03] px-1 text-[12px] font-semibold text-secondary transition hover:border-black/15 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
                  >
                    <span className="truncate">View All</span>
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
