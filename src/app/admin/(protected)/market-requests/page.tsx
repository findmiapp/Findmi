import {
  getPendingMarketRequestGroups,
  getActiveMarketAreasForAdmin,
  getRecentlyResolvedMarketRequests,
  RESOLUTION_TYPE_LABEL,
} from "@/lib/admin/market-requests";
import { getAllMarketsForAdmin } from "@/lib/admin/business-markets";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import {
  mapMarketRequestGroup,
  mapMarketRequestGroupToArea,
  createMarketAreaAndResolveGroup,
  approveMarketRequestGroupAsNewMarket,
  rejectMarketRequestGroup,
  correctMarketRequestText,
  reopenMarketRequest,
} from "./actions";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  consumer: "Consumer",
  business_creation: "Business creation",
  event_creation: "Event creation",
};

/** Market Requests queue — every PENDING request (consumer, business
 * creation, or event creation) that couldn't be matched to a canonical
 * FindMi Market/Area, grouped by EFFECTIVE normalized text key (Market ->
 * Area/Submarket Hierarchy V2 — see lib/admin/market-requests.ts) so
 * repeated demand for the same geography, including geography an admin
 * has corrected into agreement, shows as one card with real counts
 * instead of a wall of near-duplicate rows. Nothing here is a canonical
 * Market/Area until an admin explicitly resolves it — see actions.ts. */
export default async function AdminMarketRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const marketsAdmin = getAdminSupabase();
  const [groups, markets, areas, resolved] = await Promise.all([
    getPendingMarketRequestGroups(),
    marketsAdmin ? getAllMarketsForAdmin(marketsAdmin) : Promise.resolve([]),
    marketsAdmin ? getActiveMarketAreasForAdmin(marketsAdmin) : Promise.resolve([]),
    getRecentlyResolvedMarketRequests(12),
  ]);
  const activeMarkets = markets.filter((m) => m.active);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Market Requests</h1>
      <p className="mt-1 text-sm text-ink/60">
        Geography consumers, businesses, or events have asked for that isn&rsquo;t a Findmi Market or Area yet. Map
        each to an existing Market or Area, create a new Area under an existing Market, approve a genuinely new
        Market, or reject it — nothing here grants discovery until you do.
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
              <div key={group.effectiveKey} className="rounded-2xl border border-black/10 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-base font-semibold tracking-tight text-ink">
                      {group.displayText}
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

                {/* V2 — a lightweight local suggestion against existing
                    active Markets/Areas, never applied automatically. One
                    click resolves this whole group to it via the same
                    Map-to-Market/Area actions used below. */}
                {group.suggestedMatch && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-findmi/25 bg-findmi-50 px-3 py-2 text-xs text-findmi-700">
                    <span>
                      Possible match: <strong>{group.suggestedMatch.label}</strong>
                    </span>
                    <form
                      action={group.suggestedMatch.type === "area" ? mapMarketRequestGroupToArea : mapMarketRequestGroup}
                    >
                      {requestIdInputs}
                      <input
                        type="hidden"
                        name={group.suggestedMatch.type === "area" ? "area_id" : "market_id"}
                        value={group.suggestedMatch.type === "area" ? group.suggestedMatch.areaId : group.suggestedMatch.marketId}
                      />
                      <button
                        type="submit"
                        className="rounded-full bg-findmi px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
                      >
                        Resolve to this
                      </button>
                    </form>
                  </div>
                )}

                {/* Underlying requests — original submission preserved and
                    shown alongside any admin correction, with an inline
                    Edit/Correct action per V2's own requirement. */}
                <ul className="mt-3 flex flex-col gap-2 text-xs text-ink/55">
                  {group.requests.map((r) => (
                    <li key={r.id} className="rounded-lg border border-black/5 bg-black/[0.015] p-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-ink/70">{SOURCE_LABEL[r.source] ?? r.source}</span>
                        {r.businessName ? <span>— {r.businessName}</span> : null}
                        {r.eventName ? <span>— {r.eventName}</span> : null}
                        {r.requester_email ? <span>— {r.requester_email}</span> : null}
                      </div>
                      <div className="mt-1 text-ink/45">
                        Original submission: <span className="text-ink/70">&ldquo;{r.requested_text}&rdquo;</span>
                        {r.canonical_text && r.canonical_text !== r.requested_text && (
                          <>
                            {" "}
                            → corrected to: <span className="font-semibold text-ink/80">&ldquo;{r.canonical_text}&rdquo;</span>
                          </>
                        )}
                      </div>
                      {/* Reopen Request pass — only ever present on a
                          reopened row (a fresh pending request has no
                          mapped_market_id/mapped_area_id yet), so this
                          context only shows up exactly when it's useful:
                          right after an admin has sent a mistaken
                          resolution back for correction. */}
                      {(r.previousAreaLabel || r.previousMarketLabel) && (
                        <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">
                          Previously resolved to:{" "}
                          <span className="font-semibold">{r.previousAreaLabel || r.previousMarketLabel}</span> — reopened for
                          correction.
                        </div>
                      )}
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[11px] font-semibold text-ink/50 underline underline-offset-2 [&::-webkit-details-marker]:hidden">
                          Edit / Correct
                        </summary>
                        <form action={correctMarketRequestText} className="mt-1.5 flex items-center gap-1.5">
                          <input type="hidden" name="request_id" value={r.id} />
                          <input
                            type="text"
                            name="canonical_text"
                            defaultValue={r.canonical_text ?? r.requested_text}
                            className="w-full max-w-[220px] rounded-lg border border-black/10 bg-white px-2 py-1 text-xs text-ink focus:border-ink/30 focus:outline-none"
                          />
                          <button
                            type="submit"
                            className="shrink-0 rounded-full border border-black/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30 hover:text-ink"
                          >
                            Save
                          </button>
                        </form>
                      </details>
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

                  <form
                    action={mapMarketRequestGroupToArea}
                    className="flex flex-col gap-2 rounded-xl border border-black/10 p-3"
                  >
                    <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Map to Existing Area/Submarket</p>
                    {requestIdInputs}
                    <select
                      name="area_id"
                      defaultValue=""
                      disabled={areas.length === 0}
                      className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-ink focus:border-ink/30 focus:outline-none disabled:opacity-50"
                    >
                      <option value="" disabled>
                        {areas.length === 0 ? "No Areas yet" : "Choose an area…"}
                      </option>
                      {areas.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.displayName || a.name} — {a.marketName}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      disabled={areas.length === 0}
                      className="mt-1 rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-50"
                    >
                      Map
                    </button>
                  </form>

                  <form action={rejectMarketRequestGroup} className="flex flex-col gap-2 rounded-xl border border-black/10 p-3 sm:col-span-2">
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
                      className="mt-1 self-start rounded-full border border-red-200 px-4 py-2 text-xs font-bold uppercase tracking-wide text-red-600 transition hover:bg-red-50"
                    >
                      Reject
                    </button>
                  </form>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <details className="group">
                    <summary className="cursor-pointer text-xs font-semibold text-ink/50 underline underline-offset-2 [&::-webkit-details-marker]:hidden">
                      Create new Area under an existing Market
                    </summary>
                    <form
                      action={createMarketAreaAndResolveGroup}
                      className="mt-2 flex flex-col gap-2 rounded-xl border border-black/10 bg-mist/30 p-3"
                    >
                      {requestIdInputs}
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-ink/60">Parent Market</span>
                        <select
                          name="market_id"
                          defaultValue=""
                          required
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
                      </label>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-ink/60">Area Name</span>
                          <input
                            type="text"
                            name="name"
                            required
                            defaultValue={group.displayText}
                            className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-ink focus:border-ink/30 focus:outline-none"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-ink/60">Consumer Display Name</span>
                          <input
                            type="text"
                            name="display_name"
                            placeholder={group.displayText}
                            className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
                          />
                        </label>
                      </div>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-ink/60">Aliases (comma-separated, optional)</span>
                        <input
                          type="text"
                          name="aliases"
                          placeholder="e.g. SI, Staten Isl."
                          className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
                        />
                      </label>
                      <label className="flex items-center gap-2 text-sm text-ink">
                        <input type="checkbox" name="consumer_visible" className="h-4 w-4 accent-findmi" />
                        Show in consumer Area picker now
                      </label>
                      <button
                        type="submit"
                        className="mt-1 self-start rounded-full bg-ink px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-ink/85"
                      >
                        Create Area &amp; Resolve
                      </button>
                    </form>
                  </details>

                  <details className="group">
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
                            defaultValue={group.displayText}
                            className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-ink focus:border-ink/30 focus:outline-none"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-ink/60">Consumer Display Name</span>
                          <input
                            type="text"
                            name="display_name"
                            placeholder={group.displayText}
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
              </div>
            );
          })
        )}
      </div>

      {/* V2 — a plain recent-history strip so an admin can confirm exactly
          which of the four resolution paths (or rejection) a request went
          through, without a separate history page. An Area resolution
          always shows both the Area and its parent Market together, never
          the Area alone. */}
      {resolved.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink/40">Recently Resolved</h2>
          <ul className="mt-2 flex flex-col gap-1.5">
            {resolved.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/5 bg-black/[0.015] p-2.5 text-xs text-ink/60"
              >
                <span>
                  <span className="font-semibold text-ink/80">
                    {r.canonicalText && r.canonicalText !== r.requestedText ? r.canonicalText : r.requestedText}
                  </span>
                  {r.canonicalText && r.canonicalText !== r.requestedText && (
                    <span className="text-ink/40"> (originally &ldquo;{r.requestedText}&rdquo;)</span>
                  )}
                  {" — "}
                  <span className="font-semibold">
                    {r.status === "rejected" ? "Rejected" : (r.resolutionType && RESOLUTION_TYPE_LABEL[r.resolutionType]) || r.status}
                  </span>
                  {r.areaLabel ? ` → ${r.areaLabel}` : r.marketLabel ? ` → ${r.marketLabel}` : ""}
                  {r.adminNote && <span className="text-ink/40"> — {r.adminNote}</span>}
                </span>
                {/* Reopen Request pass — the fix for "resolved requests are
                    permanent dead ends": sends this exact row back to the
                    pending queue above (with its prior resolution kept
                    visible as context) so a mistaken Map/Create/Reject can
                    be corrected through the same actions, never a raw DB
                    edit. */}
                <form action={reopenMarketRequest}>
                  <input type="hidden" name="request_id" value={r.id} />
                  <button
                    type="submit"
                    className="shrink-0 rounded-full border border-black/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-ink/60 transition hover:border-ink/30 hover:text-ink"
                  >
                    Reopen
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
