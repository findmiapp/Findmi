import Link from "next/link";

export interface TabNavItem {
  key: string;
  label: string;
}

/**
 * Admin entity sections (?tab=<key>) — plain server-rendered links, no
 * client JS; switching sections is a normal navigation.
 *
 * Admin V2 Pass 1 — no more horizontally scrolling (and clipping) strip:
 *   phones (< sm) — one compact "Section: <current>" control that opens
 *                   the full list (native <details>, every section
 *                   reachable, nothing off-screen);
 *   sm and up     — the same pills, wrapping onto a second line instead
 *                   of scrolling sideways.
 */
export default function AdminTabNav({
  items,
  activeKey,
  basePath,
}: {
  items: TabNavItem[];
  activeKey: string;
  basePath: string;
}) {
  const active = items.find((i) => i.key === activeKey) ?? items[0];
  return (
    <nav aria-label="Sections">
      <details className="group relative sm:hidden">
        <summary className="flex h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl border border-black/10 bg-white px-3.5 text-body font-semibold text-primary transition hover:border-black/20 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 truncate">
            <span className="font-medium text-muted">Section · </span>
            {active?.label}
          </span>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4 shrink-0 text-ink/40 transition group-open:rotate-180">
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </summary>
        <div className="absolute inset-x-0 top-full z-[35] mt-1.5 max-h-[60vh] overflow-y-auto rounded-xl border border-black/10 bg-white p-1 shadow-lg">
          {items.map((item) => {
            const isActive = item.key === activeKey;
            return (
              <Link
                key={item.key}
                href={`${basePath}?tab=${item.key}`}
                aria-current={isActive ? "page" : undefined}
                className={`flex min-h-[44px] items-center rounded-lg px-3 text-body transition ${
                  isActive ? "bg-findmi-50 font-semibold text-findmi-700" : "font-medium text-primary hover:bg-black/[0.04]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </details>

      <div className="hidden flex-wrap gap-1 sm:flex">
        {items.map((item) => {
          const isActive = item.key === activeKey;
          return (
            <Link
              key={item.key}
              href={`${basePath}?tab=${item.key}`}
              aria-current={isActive ? "page" : undefined}
              className={`rounded-full px-3 py-1.5 text-metadata font-semibold transition ${
                isActive ? "bg-findmi-50 text-findmi-700" : "text-muted hover:bg-black/[0.04] hover:text-primary"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
