import { notFound } from "next/navigation";
import Link from "next/link";
import { getAdminMarketById } from "@/lib/admin/markets";
import { getAdminAreasByMarket } from "@/lib/admin/market-areas";
import MarketForm from "../MarketForm";

export const dynamic = "force-dynamic";

export default async function EditMarketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { error, saved } = await searchParams;
  const [market, areas] = await Promise.all([getAdminMarketById(id), getAdminAreasByMarket(id)]);
  if (!market) notFound();

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Edit Market</h1>
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved.
        </p>
      )}
      <div className="mt-5">
        <MarketForm market={market} error={error} />
      </div>

      {/* Market -> Area Admin Management Completion pass — the missing
          control surface this pass exists to add: every Area belonging
          to THIS Market, with a direct Edit link and a way to add a new
          one scoped to this Market (market_id is never manually chosen —
          see AreaForm/saveMarketArea). Reads the same market_areas table
          AreaPicker already consumes, no parallel geography system. */}
      <section className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Areas in this Market</h2>
            <p className="mt-0.5 text-xs text-ink/45">
              {areas.length} Area{areas.length === 1 ? "" : "s"}
            </p>
          </div>
          <Link
            href={`/admin/markets/${market.id}/areas/new`}
            className="shrink-0 rounded-full bg-findmi px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          >
            + Add Area
          </Link>
        </div>

        {areas.length === 0 ? (
          <p className="mt-3 rounded-xl border border-black/5 bg-black/[0.015] p-4 text-sm text-ink/50">
            No Areas have been added to this Market yet.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {areas.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-black/5 bg-white px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{a.name}</p>
                  <p className="mt-0.5 truncate text-xs text-ink/45">
                    {a.active ? "Active" : "Inactive"} · {a.consumer_visible ? "Visible to consumers" : "Hidden from consumers"}
                    {" · "}Order {a.sort_order}
                  </p>
                </div>
                <Link
                  href={`/admin/markets/${market.id}/areas/${a.id}`}
                  className="shrink-0 rounded-full border border-black/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:border-black/20"
                >
                  Edit
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
