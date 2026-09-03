import Link from "next/link";
import { logout } from "../login/actions";
import AdminNav from "@/components/admin/AdminNav";
import AdminHeaderControls from "@/components/admin/AdminHeaderControls";

export default function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <header className="sticky top-0 z-10 border-b border-black/5 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-1">
            {/* Admin Header — Home + Back Controls pass: replaces the old
                "View Homepage" link (which opened in a new tab) — Home
                below covers that same destination, same tab, plus a Back
                control right next to it. */}
            <AdminHeaderControls />
            <Link href="/admin" className="font-display text-sm font-bold tracking-tight text-ink">
              FindMi Admin
            </Link>
          </div>
          {/* Shared admin shell (item 5) — one link here covers every
              admin page rather than each page implementing its own. */}
          <div className="flex items-center gap-4">
            <form action={logout}>
              <button type="submit" className="text-xs font-semibold text-ink/50 hover:text-ink">
                Sign Out
              </button>
            </form>
          </div>
        </div>
        {/* Admin Navigation Simplify + Organize pass — primary destinations
            + a "More" dropdown for everything else, see AdminNav.tsx. */}
        <AdminNav />
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
