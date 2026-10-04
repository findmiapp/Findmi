"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getAdminSection, resolveAdminRoute } from "../adminNavItems";
import AdminQuickCreate from "./AdminQuickCreate";

/** Admin V2 — mobile/tablet header (below lg): Findmi Admin identity with
 * the current section, plus Quick Create. Navigation itself lives in the
 * bottom bar; going back up a level lives in AdminBreadcrumb. */
export default function AdminTopBar() {
  const pathname = usePathname();
  const { section, item } = resolveAdminRoute(pathname);
  const sectionLabel = section === "home" ? null : getAdminSection(section).label;
  const context = item?.label ?? sectionLabel;

  return (
    <header className="sticky top-0 z-30 border-b border-black/[0.06] bg-white/95 backdrop-blur lg:hidden">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/admin" className="min-w-0 truncate font-display text-card-title font-bold text-primary">
          Findmi <span className="text-findmi-600">Admin</span>
          {context && <span className="font-sans text-metadata font-medium text-muted"> · {context}</span>}
        </Link>
        <AdminQuickCreate compact align="right" />
      </div>
    </header>
  );
}
