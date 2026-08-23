import { getAllMembershipPlans } from "@/lib/admin/membership-queries";
import SubmitBar from "@/components/admin/SubmitBar";
import { savePlans } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminPlansPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const plans = await getAllMembershipPlans();

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
        Membership Plans
      </h1>
      <p className="mt-1 text-sm text-ink/60">
        Price, market limit, and public visibility for each plan. Name/slug/founder-facing copy
        stay fixed on purpose — edit price, limits, and availability here.
      </p>
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved.
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <form action={savePlans} className="mt-5 flex flex-col gap-4">
        {plans.length === 0 ? (
          <p className="text-sm text-ink/50">No plans yet.</p>
        ) : (
          plans.map((p) => (
            <div key={p.id} className="rounded-2xl border border-black/10 bg-white p-4">
              <input type="hidden" name="all_plan_ids" value={p.id} />
              <div className="flex items-center justify-between gap-3">
                <p className="font-display text-base font-semibold tracking-tight text-ink">{p.name}</p>
                <span className="text-xs text-ink/40">{p.slug}</span>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-ink/60">Annual Price ($)</span>
                  <input
                    type="number"
                    step="0.01"
                    name={`price_${p.id}`}
                    defaultValue={p.annual_price}
                    className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink focus:border-ink/30 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-ink/60">Market Limit</span>
                  <input
                    type="number"
                    name={`market_limit_${p.id}`}
                    defaultValue={p.market_limit ?? ""}
                    placeholder="Blank = unlimited"
                    className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
                  />
                </label>
              </div>

              <label className="mt-3 block">
                <span className="mb-1 block text-xs font-medium text-ink/60">Description (public copy)</span>
                <textarea
                  name={`description_${p.id}`}
                  defaultValue={p.description ?? ""}
                  rows={2}
                  className="w-full resize-y rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink focus:border-ink/30 focus:outline-none"
                />
              </label>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                <Toggle name={`active_${p.id}`} label="Active" defaultChecked={p.active} />
                <Toggle name={`public_${p.id}`} label="Public" defaultChecked={p.publicly_available} />
                <Toggle name={`featured_${p.id}`} label="Featured Placement" defaultChecked={p.featured_placement_eligible} />
                <Toggle name={`enhanced_${p.id}`} label="Enhanced Profile" defaultChecked={p.enhanced_profile} />
                <Toggle name={`campaign_${p.id}`} label="Campaign Eligible" defaultChecked={p.campaign_eligible} />
              </div>
            </div>
          ))
        )}

        <SubmitBar cancelHref="/admin" />
      </form>
    </div>
  );
}

function Toggle({ name, label, defaultChecked }: { name: string; label: string; defaultChecked: boolean }) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-black/10 px-2.5 py-2 text-xs">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="h-4 w-4 shrink-0 accent-findmi" />
      <span className="text-ink/70">{label}</span>
    </label>
  );
}
