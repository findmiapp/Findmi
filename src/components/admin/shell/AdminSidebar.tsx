"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import SignOutConfirm from "@/components/SignOutConfirm";
import { logout } from "@/app/admin/login/actions";
import { ADMIN_SECTIONS, isActive, resolveAdminRoute } from "../adminNavItems";
import { AdminSectionIcon, ExternalGlyph } from "./AdminIcons";
import AdminQuickCreate from "./AdminQuickCreate";

/** Admin V2 — the desktop (lg+) persistent rail. Every section is a
 * labelled group whose destinations stay visible (Admin is denser than
 * /account: one click to any area, no dropdowns). The section heading
 * itself opens that section's hub. Utility links (public site, account,
 * sign out) sit quietly at the bottom. */
export default function AdminSidebar() {
  const pathname = usePathname();
  const { section: activeSection, item: activeItem } = resolveAdminRoute(pathname);

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-black/[0.06] bg-white lg:sticky lg:top-0 lg:flex lg:h-screen">
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-4">
        <Link href="/admin" className="font-display text-card-title font-bold text-primary">
          Findmi <span className="text-findmi-600">Admin</span>
        </Link>
        <AdminQuickCreate compact align="left" />
      </div>

      <nav aria-label="Admin" className="flex-1 overflow-y-auto px-3 pb-4">
        {ADMIN_SECTIONS.map((section) => {
          const sectionActive = section.key === activeSection;
          const onHub = section.key === "home" ? pathname === "/admin" : pathname === section.href;
          return (
            <div key={section.key} className={section.key === "home" ? "" : "mt-3"}>
              <Link
                href={section.href}
                aria-current={onHub ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-semibold transition ${
                  onHub
                    ? "bg-findmi-50 text-findmi-700"
                    : sectionActive
                      ? "text-primary hover:bg-black/[0.03]"
                      : "text-secondary hover:bg-black/[0.03] hover:text-primary"
                }`}
              >
                <AdminSectionIcon section={section.key} className={`h-[18px] w-[18px] shrink-0 ${sectionActive ? "text-findmi-700" : "text-ink/40"}`} />
                {section.label}
              </Link>
              {section.groups.length > 0 && (
                <div className="mt-0.5 flex flex-col gap-px pl-[30px]">
                  {section.groups.flatMap((g) => g.items).map((item) => {
                    const active = activeItem?.href === item.href || (!activeItem && isActive(pathname, item.href));
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`block truncate rounded-lg px-2.5 py-1.5 text-[13px] transition ${
                          active ? "bg-findmi-50 font-semibold text-findmi-700" : "text-muted hover:bg-black/[0.03] hover:text-primary"
                        }`}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-black/[0.06] p-3 text-[13px]">
        <Link href="/" className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 font-medium text-muted transition hover:bg-black/[0.03] hover:text-primary">
          <ExternalGlyph className="h-4 w-4" />
          View Findmi
        </Link>
        <Link href="/account" className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 font-medium text-muted transition hover:bg-black/[0.03] hover:text-primary">
          <ExternalGlyph className="h-4 w-4" />
          Your account
        </Link>
        <SignOutConfirm
          action={logout}
          className="block w-full rounded-lg px-2.5 py-1.5 text-left font-medium text-muted transition hover:bg-black/[0.03] hover:text-primary"
        >
          Sign out
        </SignOutConfirm>
      </div>
    </aside>
  );
}
