"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_SECTIONS, resolveAdminRoute } from "../adminNavItems";
import { AdminSectionIcon } from "./AdminIcons";

/** Admin V2 — mobile/tablet primary navigation: a fixed, safe-area-aware
 * bottom bar with five equal columns (never a scrolling strip), the same
 * pattern as the approved /account V2 shell. Hidden at lg+, where the
 * persistent AdminSidebar takes over. */
export default function AdminMobileNav() {
  const pathname = usePathname();
  const { section } = resolveAdminRoute(pathname);

  return (
    <nav
      aria-label="Admin"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-black/[0.07] bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <div className="mx-auto grid max-w-lg grid-cols-5">
        {ADMIN_SECTIONS.map((s) => {
          const active = s.key === section;
          return (
            <Link
              key={s.key}
              href={s.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 pt-1.5 text-[10.5px] font-semibold leading-tight transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-findmi/40 ${
                active ? "text-accent" : "text-ink/45 hover:text-ink/70"
              }`}
            >
              <span className={`flex h-7 w-12 items-center justify-center rounded-full transition ${active ? "bg-findmi-50" : ""}`}>
                <AdminSectionIcon section={s.key} className="h-[22px] w-[22px]" />
              </span>
              <span className="max-w-full truncate">{s.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
