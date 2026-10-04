"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getAdminSection, resolveAdminRoute } from "../adminNavItems";
import { ChevronLeftGlyph } from "./AdminIcons";

/** Admin V2 — "where am I / go up a level" for every page below a
 * destination's own list (detail, new, edit): Section › Destination,
 * with a compact back-to-list control on phones. Renders nothing on hubs
 * and list pages, where the page title already says it. */
export default function AdminBreadcrumb() {
  const pathname = usePathname();
  const { section, item, isDetail } = resolveAdminRoute(pathname);
  if (!item || !isDetail) return null;
  const sectionDef = getAdminSection(section);
  const showItemCrumb = item.href !== sectionDef.href;

  return (
    <nav aria-label="Breadcrumb" className="mb-3 flex min-w-0 items-center gap-1.5 text-metadata">
      <Link
        href={item.href}
        className="flex h-8 shrink-0 items-center gap-1 rounded-full pr-2 font-semibold text-findmi-700 transition hover:text-findmi-600 sm:hidden"
      >
        <ChevronLeftGlyph className="h-4 w-4" />
        {item.label}
      </Link>
      <span className="hidden min-w-0 items-center gap-1.5 text-muted sm:flex">
        <Link href={sectionDef.href} className="hover:text-primary">
          {sectionDef.label}
        </Link>
        {showItemCrumb && (
          <>
            <span aria-hidden="true" className="text-ink/25">
              /
            </span>
            <Link href={item.href} className="truncate font-semibold text-secondary hover:text-primary">
              {item.label}
            </Link>
          </>
        )}
      </span>
    </nav>
  );
}
