import Link from "next/link";
import { getDashboardCounts } from "@/lib/admin/queries";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const counts = await getDashboardCounts();

  const cards = [
    {
      href: "/admin/businesses",
      label: "Businesses",
      count: counts?.businesses,
      detail: counts ? `${counts.businessesPublic} public` : undefined,
    },
    { href: "/admin/events", label: "Events", count: counts?.events },
    { href: "/admin/locations", label: "Locations", count: counts?.locations },
    { href: "/admin/appearances", label: "Appearances", count: counts?.appearances },
    { href: "/admin/products", label: "Products", count: counts?.products },
    { href: "/admin/categories", label: "Homepage Categories", count: counts?.categories },
  ];

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Dashboard</h1>
      <p className="mt-1 text-sm text-ink/60">
        Manage FindMi&rsquo;s content — businesses, events, locations, appearances, and products.
      </p>

      {!counts && (
        <p className="mt-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Server-side Supabase access isn&rsquo;t configured (missing
          SUPABASE_SERVICE_ROLE_KEY). Counts can&rsquo;t load, and writes will fail
          until it&rsquo;s set.
        </p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="rounded-2xl border border-black/5 bg-white p-4 transition hover:border-black/10 hover:shadow-sm"
          >
            <p className="font-display text-2xl font-semibold text-ink">{c.count ?? "—"}</p>
            <p className="mt-1 text-sm font-medium text-ink">{c.label}</p>
            {c.detail && <p className="text-xs text-ink/45">{c.detail}</p>}
          </Link>
        ))}
      </div>
    </div>
  );
}
