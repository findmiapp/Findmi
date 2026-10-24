import Link from "next/link";
import CreateActionIcon from "./CreateActionIcon";
import { businessQuickActions } from "./quickActions";

/** Quick Actions — a thin, horizontally swipeable rail right under the
 * Business identity: small aqua circles with short bold labels. The next
 * action peeks past the edge so the scroll is discoverable. Every item is a
 * real link with an accessible name; no item is icon-only. `contain:
 * inline-size` keeps the rail from ever widening its container: it scrolls.
 * Gutter: the rail bleeds to the viewport edge (-mx-4) so swiped items
 * scroll under it, but the list keeps the Manager's 16px page gutter (px-4)
 * AND the same scroll-padding (scroll-px-4) — without it, snap-start
 * aligns the first action to the scrollport's edge (x = 0), so it touched
 * the viewport edge. The trailing spacer keeps the same gutter after the
 * last action. */
export default function QuickActionsRail({ businessId }: { businessId: string }) {
  const actions = businessQuickActions(businessId);
  return (
    <nav aria-label="Quick Actions" className="-mx-4 min-w-0 [contain:inline-size] sm:mx-0">
      <ul className="flex snap-x scroll-px-4 gap-0.5 overflow-x-auto overscroll-x-contain px-4 [scrollbar-width:none] sm:scroll-px-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
        {actions.map((a) => (
          <li key={a.key} className="shrink-0 snap-start">
            <Link
              href={a.href}
              aria-label={a.ariaLabel}
              className="group flex min-w-[72px] flex-col items-center gap-1 rounded-2xl px-1.5 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-findmi-50 text-findmi-700 transition group-hover:bg-findmi-100 group-active:scale-95">
                {a.icon === "target" ? <TargetGlyph className="h-5 w-5" /> : <CreateActionIcon icon={a.icon} className="h-5 w-5" />}
              </span>
              <span className="w-full whitespace-nowrap text-center text-[12px] font-bold leading-tight text-primary">{a.label}</span>
            </Link>
          </li>
        ))}
        <li aria-hidden="true" className="w-3 shrink-0 sm:hidden" />
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
