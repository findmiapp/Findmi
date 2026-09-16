import Link from "next/link";
import { logout } from "../login/actions";
import AdminNav from "@/components/admin/AdminNav";
import AdminSidebar from "@/components/admin/AdminSidebar";
import AdminHeaderControls from "@/components/admin/AdminHeaderControls";
import SignOutConfirm from "@/components/SignOutConfirm";

/** Command Center V5 pass — desktop (lg:+) gets a persistent left
 * AdminSidebar (wordmark, Back/Home, full primary + secondary navigation,
 * Sign Out) instead of the old top pill-row + "More" dropdown, so desktop
 * reads as a real operating surface and every admin page's main content
 * starts with zero chrome above it. Mobile/tablet (below lg) is
 * completely unchanged — same header, same AdminNav — just now wrapped in
 * `lg:hidden` since the sidebar takes over above that breakpoint. Every
 * existing route/destination/action (Sign Out, Back, Home, every nav
 * item) is reachable from exactly one of the two, never both, never
 * neither. */
export default function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="lg:flex lg:min-h-screen">
      <AdminSidebar />
      <div className="flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-black/5 bg-white lg:hidden">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
            <div className="flex items-center gap-1">
              {/* Admin Header — Home + Back Controls pass: replaces the old
                  "View Homepage" link (which opened in a new tab) — Home
                  below covers that same destination, same tab, plus a Back
                  control right next to it. */}
              <AdminHeaderControls />
              <Link href="/admin" className="font-display text-sm font-bold tracking-tight text-ink">
                Findmi Admin
              </Link>
            </div>
            {/* Shared admin shell (item 5) — one link here covers every
                admin page rather than each page implementing its own. */}
            <div className="flex items-center gap-4">
              {/* Sign-Out Confirmation pass — same confirm dialog as the
                  consumer side; admin's own destroySession()/redirect stays
                  exactly as it was. */}
              <SignOutConfirm action={logout} className="text-xs font-semibold text-ink/50 hover:text-ink">
                Sign Out
              </SignOutConfirm>
            </div>
          </div>
          {/* Admin Navigation Simplify + Organize pass — primary destinations
              + a "More" dropdown for everything else, see AdminNav.tsx. */}
          <AdminNav />
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 sm:px-6 lg:px-10 lg:py-7">{children}</main>
      </div>
    </div>
  );
}
