import Link from "next/link";
import { logout } from "../login/actions";

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/site", label: "Site Editor" },
  { href: "/admin/businesses", label: "Businesses" },
  { href: "/admin/people", label: "People" },
  { href: "/admin/onboarding", label: "Onboarding" },
  { href: "/admin/claims", label: "Claims" },
  { href: "/admin/plans", label: "Plans" },
  { href: "/admin/forms", label: "Forms" },
  { href: "/admin/events", label: "Events" },
  { href: "/admin/locations", label: "Locations" },
  { href: "/admin/appearances", label: "Appearances" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/categories", label: "Categories" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/settlements", label: "Settlements" },
  { href: "/admin/users", label: "Users" },
];

export default function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <header className="sticky top-0 z-10 border-b border-black/5 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/admin" className="font-display text-sm font-bold tracking-tight text-ink">
            FindMi Admin
          </Link>
          {/* Shared admin shell (item 5) — one link here covers every
              admin page rather than each page implementing its own. */}
          <div className="flex items-center gap-4">
            <Link
              href="/"
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold text-ink/50 hover:text-ink"
            >
              View Homepage
            </Link>
            <form action={logout}>
              <button type="submit" className="text-xs font-semibold text-ink/50 hover:text-ink">
                Sign Out
              </button>
            </form>
          </div>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 pb-2 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold text-ink/60 transition hover:bg-black/[0.04] hover:text-ink"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
