import Link from "next/link";
import { getAdminMarkets } from "@/lib/admin/markets";
import { getAdminAreaVisibilityByMarket } from "@/lib/admin/market-areas";
import { adminVisibilityLabel, isMarketVisibleOnFindmi } from "@/lib/area-visibility";

export const dynamic = "force-dynamic";

export default async function AdminMarketsPage() {
  const [markets, areasByMarket] = await Promise.all([getAdminMarkets(), getAdminAreaVisibilityByMarket()]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Markets</h1>
          <p className="mt-1 text-sm text-ink/60">
            The canonical Findmi Markets used for business distribution/entitlement and event geography — shown
            to consumers as &ldquo;Area&rdquo;. Only Markets and Areas marked Visible on Findmi appear in public
            Area selectors; hidden ones still accept Businesses, Locations, Events and Appearances.
          </p>
        </div>
        <Link
          href="/admin/markets/new"
          className="shrink-0 rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          + Add Market
        </Link>
      </div>

      <div className="mt-5 flex flex-col gap-2">
        {markets.length === 0 ? (
          <p className="text-sm text-ink/50">No markets yet.</p>
        ) : (
          markets.map((m) => (
            <Link
              key={m.id}
              href={`/admin/markets/${m.id}`}
              className="flex items-center justify-between gap-3 rounded-2xl border border-black/5 bg-white p-4 transition hover:border-black/10 hover:shadow-sm"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-display text-base font-semibold tracking-tight text-ink">{m.name}</p>
                  {/* Visible on Findmi at a glance (Area Visibility pass). */}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      isMarketVisibleOnFindmi(m) ? "bg-findmi-50 text-findmi-700" : "bg-black/[0.06] text-ink/50"
                    }`}
                  >
                    {adminVisibilityLabel(m)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-ink/45">
                  /{m.slug}
                  {m.display_name && m.display_name !== m.name ? ` · Consumer: “${m.display_name}”` : ""}
                  {" · "}
                  {(areasByMarket.get(m.id) ?? []).length} Area{(areasByMarket.get(m.id) ?? []).length === 1 ? "" : "s"}
                </p>
                {(areasByMarket.get(m.id) ?? []).length > 0 && (
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {(areasByMarket.get(m.id) ?? []).map((a) => {
                      const label = adminVisibilityLabel(a, m);
                      const shown = label === "Visible on Findmi";
                      return (
                        <li
                          key={a.id}
                          title={label}
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${shown ? "bg-findmi-50 text-findmi-700" : "bg-black/[0.04] text-ink/45 line-through decoration-ink/25"}`}
                        >
                          {a.name}
                          <span className="sr-only"> — {label}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <span className="shrink-0 text-xs text-ink/40">Order {m.sort_order}</span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
