import { getPendingMarketRequestGroups } from "@/lib/admin/market-requests";
import { getAllMarketsForAdmin } from "@/lib/admin/business-markets";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { mapMarketRequestGroup, approveMarketRequestGroupAsNewMarket, rejectMarketRequestGroup } from "./actions";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  consumer: "Consumer",
  business_creation: "Business creation",
  event_creation: "Event creation",
};

/** Market Requests queue — every PENDING request (consumer, business
 * creation, or event creation) that couldn't be matched to a canonical
 * FindMi Market, grouped by a lightweight normalized text key so
 * repeated demand for the same geography ("Austin" / "austin" /
 * "Austin, TX") shows as one card with real counts instead of a wall of
 * near-duplicate rows. Nothing here is a canonical Market until an
 * admin explicitly maps or approves it — see actions.ts. */
export default async function AdminMarketRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const marketsAdmin = getAdminSupabase();
  const [groups, markets] = await Promise.all([
    getPendingMarketRequestGroups(),
    marketsAdmin ? getAllMarketsForAdmin(marketsAdmin) : Promise.resolve([]),
  ]);
  const activeMarkets = markets.filter((m) => m.active);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Market Requests</h1>
      <p className="mt-1 text-sm text-ink/60">
        Geography consumers, businesses, or events have asked for that isn&rsquo;t a FindMi Market yet. Map each to
        an existing Market, approve it as a brand-new one, or reject it — nothing here grants discovery until you
        do.
      </p>
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved.
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="mt-5 flex flex-col gap-4">
        {groups.length === 0 ? (
          <p className="text-sm text-ink/50">No pending requests.</p>
        ) : (
          groups.map((group) => {
            const requestIdInputs = group.requests.map((r) => (
              <input key={r.id} type="hidden" name="request_id" value={r.id} />
            ));
            return (
              <div key={group.normalizedKey} className="rounded-2xl border border-black/10 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-base font-semibold tracking-tight text-ink">
                      {group.requestedText}
                    </p>
                    {(group.city || group.state) && (
                      <p className="text-xs text-ink/45">{[group.city, group.state].filter(Boolean).join(", ")}</p>
                    )}
                    <p className="mt-0.5 text-xs text-ink/40">
                      First requested {new Date(group.oldestCreatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-3 text-xs text-ink/60">
                    <span>
                      Consumers: <strong className="text-ink">{group.consumerInterestCount}</strong>
                    </span>
                    <span>
                      Businesses: <strong className="text-ink">{group.businessCount}</strong>
                    </span>
                    <span>
                      Events: <strong className="text-ink">{group.eventCount}</strong>
                    </span>
                  </div>
                </div>

                {/* Underlying requests — linked business/event visible so
                    admin can see exactly what's blocked on this decision. */}
                <ul className="mt-3 flex flex-col gap-1 text-xs text-ink/55">
                  {group.requests.map((r) => (
                    <li key={r.id}>
                      {SOURCE_LABEL[r.source] ?? r.source}
                      {r.businessName ? ` — ${r.businessName}` : ""}
                      {r.eventName ? ` — ${r.eventName}` : ""}
                      {r.requester_email ? ` — ${r.requester_email}` : ""}
                    </li>
                  ))}
                </ul>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <form action={mapMarketRequestGroup} className="flex flex-col gap-2 rounded-xl border border-black/10 p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Map to Existing Market</p>
                    {requestIdInputs}
                    <select
                      name="market_id"
                      defaultValue=""
                      className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-ink focus:border-ink/30 focus:outline-none"
                    >
                      <option value="" disabled>
                        Choose a market…
                      </option>
                      {activeMarkets.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="mt-1 rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
                    >
                      Map
                    </button>
                  </form>

                  <form action={rejectMarketRequestGroup} className="flex flex-col gap-2 rounded-xl border border-black/10 p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Reject</p>
                    {requestIdInputs}
                    <textarea
                      name="admin_note"
                      rows={2}
                      placeholder="Optional note"
                      className="w-full resize-y rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="mt-1 rounded-full border border-red-200 px-4 py-2 text-xs font-bold uppercase tracking-wide text-red-600 transition hover:bg-red-50"
                    >
                      Reject
                    </button>
                  </form>
                </div>

                <details className="group mt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-ink/50 underline underline-offset-2 [&::-webkit-details-marker]:hidden">
                    Approve as a new Market instead
                  </summary>
                  <form
                    action={approveMarketRequestGroupAsNewMarket}
                    className="mt-2 flex flex-col gap-2 rounded-xl border border-black/10 bg-mist/30 p-3"
                  >
                    {requestIdInputs}
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-ink/60">Internal / Admin Name</span>
                        <input
                          type="text"
                          name="name"
                          required
                          defaultValue={group.requestedText}
                          className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-ink focus:border-ink/30 focus:outline-none"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-ink/60">Consumer Display Name</span>
                        <input
                          type="text"
                          name="display_name"
                          placeholder={group.requestedText}
                          className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
                        />
                      </label>
                    </div>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-ink/60">URL Slug (optional)</span>
                      <input
                        type="text"
                        name="slug"
                        placeholder="Auto-generated from name"
                        className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-ink/60">Description (optional)</span>
                      <textarea
                        name="description"
                        rows={2}
                        className="w-full resize-y rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-ink focus:border-ink/30 focus:outline-none"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-ink/60">Display Order</span>
                        <input
                          type="number"
                          name="sort_order"
                          defaultValue={0}
                          step={1}
                          className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-ink focus:border-ink/30 focus:outline-none"
                        />
                      </label>
                      <label className="mt-5 flex items-center gap-2 text-sm text-ink">
                        <input type="checkbox" name="consumer_visible" className="h-4 w-4 accent-findmi" />
                        Show in consumer Area picker now
                      </label>
                    </div>
                    <p className="text-xs text-ink/40">
                      Default is active but hidden from consumer Area discovery — supply can exist before a public
                      launch. Check the box above to launch it immediately instead.
                    </p>
                    <button
                      type="submit"
                      className="mt-1 self-start rounded-full bg-ink px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-ink/85"
                    >
                      Create Market &amp; Resolve
                    </button>
                  </form>
                </details>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
