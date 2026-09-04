import Link from "next/link";

export interface TabNavItem {
  key: string;
  label: string;
}

/**
 * Tabbed Business Edit pass — admin counterpart to components/TabNav.tsx
 * (public Business Manager), same plain server-renderable ?tab=<key>
 * Link-based shape, just styled with AdminNav's own pill language
 * (bg-findmi-50/text-findmi-700 active, text-ink/60 inactive) instead of
 * the public site's bg-findmi/white. No client JS, no dirty-state
 * framework — switching tabs is a normal navigation.
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
  return (
    <nav
      aria-label="Sections"
      className="sticky top-0 z-10 -mx-4 flex gap-1 overflow-x-auto bg-white/95 px-4 py-2 backdrop-blur [-ms-overflow-style:none] [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
    >
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <Link
            key={item.key}
            href={`${basePath}?tab=${item.key}`}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              active ? "bg-findmi-50 text-findmi-700" : "text-ink/60 hover:bg-black/[0.04] hover:text-ink"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
