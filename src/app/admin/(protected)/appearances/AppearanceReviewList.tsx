"use client";

import { useState } from "react";
import Link from "next/link";
import { cityState, formatAppearanceDateRange, formatDateShort } from "@/lib/format";
import type { AdminAppearanceRow } from "@/lib/admin/queries";
import { markAppearanceReviewed, markAppearanceUnreviewed, markAppearancesReviewed } from "./actions";

/** Admin Where I'll Be Review Inbox V1 — the row list plus, on the
 * Unreviewed view only, bulk-selection controls.
 *
 * "Select All visible" selects exactly the ids this component was
 * handed as props — the current page's already-filtered/limited query
 * result — never a server-side "everything matching the filter." This
 * component has no way to select anything it wasn't given, by
 * construction, satisfying the "never silently select records not shown
 * on screen" requirement without any extra guard code.
 *
 * Mark Reviewed/Unreviewed and the bulk action all touch ONLY
 * admin_reviewed_at (see actions.ts) — this is Admin acknowledgement,
 * never moderation: it doesn't change public visibility, Event
 * participation, ownership, or Market/Area.
 */
export default function AppearanceReviewList({
  appearances,
  showBulk,
}: {
  appearances: AdminAppearanceRow[];
  showBulk: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allSelected = appearances.length > 0 && selected.size === appearances.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(appearances.map((a) => a.id)));
  }

  return (
    <div className="flex flex-col gap-2">
      {showBulk && appearances.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/10 bg-black/[0.02] px-3.5 py-2.5">
          <label className="flex items-center gap-2 text-xs font-semibold text-ink/70">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4" />
            Select All visible ({appearances.length})
          </label>
          <form action={markAppearancesReviewed}>
            {Array.from(selected).map((id) => (
              <input key={id} type="hidden" name="ids" value={id} />
            ))}
            <button
              type="submit"
              disabled={selected.size === 0}
              className="rounded-full bg-findmi px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Mark Selected Reviewed{selected.size > 0 ? ` (${selected.size})` : ""}
            </button>
          </form>
        </div>
      )}

      {appearances.length === 0 ? (
        <p className="text-sm text-ink/50">No results for this view.</p>
      ) : (
        appearances.map((a) => {
          const location = [a.venue_name, a.address, cityState(a.city, a.state)].filter(Boolean).join(" · ");
          const reviewed = Boolean(a.admin_reviewed_at);
          // Event + Appearance Geography Completion pass — an event-linked
          // row's effective geography is always its Event's (see
          // getFindMiHereFeed), so that's what's shown here too, never the
          // appearance's own (null-by-design) market/market_area.
          const geography = a.event ? a.event.market : a.market;
          const geographyArea = a.event ? a.event.market_area : a.market_area;
          const geographyLabel = geography ? [geography.name, geographyArea?.name].filter(Boolean).join(" — ") : null;
          return (
            <div key={a.id} className="rounded-xl border border-black/5 bg-white px-4 py-3">
              <div className="flex items-start gap-3">
                {showBulk && (
                  <input
                    type="checkbox"
                    checked={selected.has(a.id)}
                    onChange={() => toggle(a.id)}
                    className="mt-1 h-4 w-4 shrink-0"
                    aria-label={`Select ${a.title}`}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{a.title}</p>
                      <p className="truncate text-xs text-ink/60">{a.business?.name ?? "—"}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                        reviewed ? "bg-black/[0.06] text-ink/40" : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {reviewed ? "Reviewed" : "Unreviewed"}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-ink/45">
                    {formatAppearanceDateRange(a.start_at, a.end_at, a.description)}
                    {location ? ` · ${location}` : ""}
                  </p>
                  <p className="mt-1 truncate text-[11px] text-ink/40">
                    {a.event ? `Event: ${a.event.name}` : "Standalone"} · Added {formatDateShort(a.created_at)}
                    {reviewed && a.admin_reviewed_at ? ` · Reviewed ${formatDateShort(a.admin_reviewed_at)}` : ""}
                    {" · "}
                    {geographyLabel ?? "No Market assigned"}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Link
                      href={`/admin/appearances/${a.id}`}
                      className="text-[11px] font-bold uppercase tracking-wide text-findmi-700 hover:underline"
                    >
                      Open →
                    </Link>
                    {reviewed ? (
                      <form action={markAppearanceUnreviewed.bind(null, a.id)}>
                        <button
                          type="submit"
                          className="rounded-full border border-black/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-ink/60 transition hover:bg-black/[0.03]"
                        >
                          Mark Unreviewed
                        </button>
                      </form>
                    ) : (
                      <form action={markAppearanceReviewed.bind(null, a.id)}>
                        <button
                          type="submit"
                          className="rounded-full bg-findmi px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
                        >
                          Mark Reviewed
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
