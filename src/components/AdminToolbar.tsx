import Link from "next/link";
import { isAdminSession } from "@/lib/admin/auth";

// Founder-only quick-access strip across the very top of public pages —
// same self-contained "check the real admin session, render nothing
// otherwise" shape AdminEditButton already uses (see that component's own
// note): isAdminSession() reads the exact same signed httpOnly session
// cookie every /admin route and Server Action already relies on
// (src/lib/admin/auth.ts / src/middleware.ts) — never a client-side flag,
// query param, or localStorage value, so there is no separate, weaker
// check to spoof. A normal logged-in visitor or a signed-out one always
// gets null here; nothing about this file changes what "admin" means.
//
// Routes are the real /admin/(protected) routes (see that layout's own
// NAV list) — not guessed paths. "Admin" links to the dashboard root
// (/admin) and "Site" to the Site Editor (/admin/site), matching that
// same nav's Dashboard/Site Editor entries under shorter labels that fit
// a thin, compact strip.
const LINKS = [
  { href: "/admin", label: "Admin" },
  { href: "/admin/businesses", label: "Businesses" },
  { href: "/admin/events", label: "Events" },
  { href: "/admin/appearances", label: "Appearances" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/categories", label: "Categories" },
  { href: "/admin/site", label: "Site" },
];

// Height is Tailwind's `7` step (1.75rem / 28px) — thin/secondary, per the
// pass's own spec. On mobile this is `fixed` (same as MobileHeader below
// it), so MobileHeader.tsx and (public)/layout.tsx each hardcode this same
// 1.75rem figure (as `top-7` and in the content wrapper's padding) to make
// room for it — search for "1.75rem" if this height ever changes.
export default async function AdminToolbar() {
  const isAdmin = await isAdminSession();
  if (!isAdmin) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-50 h-7 border-b border-white/10 bg-ink pt-[env(safe-area-inset-top)] md:static md:inset-auto">
      <div className="mx-auto flex h-7 max-w-6xl items-center gap-4 overflow-x-auto px-3 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {LINKS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="shrink-0 whitespace-nowrap text-[11px] font-medium text-white/70 transition hover:text-white"
          >
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
