"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import NavIcon from "@/components/NavIcon";
import SignOutConfirm from "@/components/SignOutConfirm";
import AdminHeaderControls from "./AdminHeaderControls";
import { isActive, MORE_GROUPS, PRIMARY } from "./adminNavItems";
import { logout } from "@/app/admin/login/actions";

const primaryRow =
  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition";
const primaryInactive = "text-ink/65 hover:bg-black/[0.03] hover:text-ink";
const primaryActive = "bg-findmi-50 text-findmi-700";

const secondaryRow = "block truncate rounded-lg px-2.5 py-1.5 text-[13px] transition";
const secondaryInactive = "text-ink/55 hover:bg-black/[0.03] hover:text-ink";
const secondaryActive = "bg-findmi-50 font-medium text-findmi-700";

/** Command Center V5 pass — the true desktop (lg:+) Admin shell: a
 * persistent left rail replacing the old top pill-row + "More" dropdown
 * for everyone at real desktop width. Same route list as mobile's
 * AdminNav (adminNavItems.ts, one shared source of truth) — nothing here
 * removes or renames a destination, it only gives every one of them a
 * permanent, always-visible home instead of hiding most behind a
 * dropdown. Active state is Findmi Admin's one clear, intentional Aqua
 * brand moment in the shell. Hidden entirely below `lg` — AdminNav (and
 * the existing mobile header) still owns navigation there unchanged. */
export default function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-black/5 bg-white lg:flex">
      <div className="flex h-14 shrink-0 items-center border-b border-black/5 px-5">
        <Link href="/admin" className="font-display text-sm font-bold tracking-tight text-ink">
          Findmi <span className="text-findmi-600">Admin</span>
        </Link>
      </div>

      <div className="flex shrink-0 items-center border-b border-black/5 px-3 py-1.5">
        <AdminHeaderControls />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3">
        <div className="flex flex-col gap-0.5">
          {PRIMARY.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link key={item.href} href={item.href} className={`${primaryRow} ${active ? primaryActive : primaryInactive}`}>
                {item.icon && <NavIcon name={item.icon} className="h-4 w-4 shrink-0" />}
                {item.label}
              </Link>
            );
          })}
        </div>

        {MORE_GROUPS.map((group) => (
          <div key={group.label} className="mt-4">
            <p className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wide text-ink/35">{group.label}</p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link key={item.href} href={item.href} className={`${secondaryRow} ${active ? secondaryActive : secondaryInactive}`}>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-black/5 p-3">
        {/* Sign-Out Confirmation pass — same confirm dialog and
            destroySession()/redirect as the mobile header's own Sign Out;
            this is a second entry point to the identical action, not a
            second implementation. */}
        <SignOutConfirm action={logout} className="block w-full rounded-lg px-2.5 py-2 text-left text-sm font-medium text-ink/55 hover:bg-black/[0.03] hover:text-ink">
          Sign Out
        </SignOutConfirm>
      </div>
    </aside>
  );
}
