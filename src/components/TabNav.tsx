import Link from "next/link";

export interface TabNavItem {
  key: string;
  label: string;
}

/**
 * Tabbed Business Manager pass — plain, server-renderable tab strip for
 * a single page's own sections (?tab=<key> on the SAME route), not a
 * multi-route nav like AccountNav.tsx. No client JS needed: each tab is
 * a real Link, so switching tabs is a normal navigation — the active
 * section persists through refresh/back-forward/save-redirect for free,
 * with none of the dirty-state/SPA machinery a client tab component
 * would need. Same pill/findmi-accent language AccountNav already uses
 * (bg-findmi active / bg-black/[0.04] inactive) so this reads as the
 * same design system, not a new pattern.
 *
 * Mobile: horizontally scrollable (overflow-x-auto), never stacked —
 * same `-mx-4 ... px-4 sm:mx-0 sm:px-0` bleed-to-edge trick AccountNav
 * uses so the scroll area reaches the viewport edge on small screens
 * without the whole page gaining horizontal scroll.
 */
export default function TabNav({
  items,
  activeKey,
  basePath,
}: {
  items: TabNavItem[];
  activeKey: string;
  basePath: string;
}) {
  return (
    <nav
      aria-label="Sections"
      className="sticky top-0 z-10 -mx-4 flex gap-1.5 overflow-x-auto bg-paper/95 px-4 py-2 backdrop-blur [-ms-overflow-style:none] [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
    >
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <Link
            key={item.key}
            href={`${basePath}?tab=${item.key}`}
            className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold transition ${
              active ? "bg-findmi text-white" : "bg-black/[0.04] text-ink/60 hover:bg-black/[0.07]"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
