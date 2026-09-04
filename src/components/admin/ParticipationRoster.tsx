"use client";

import { useState, useTransition } from "react";
import { Avatar, EntitySearchAdd, type SearchResult } from "./RelationPicker";
import type { AdminOccurrenceVendor, EventParticipant } from "@/lib/admin/queries";
import type { EventOccurrence } from "@/lib/types";
import { formatDateShortInZone, formatTimeInZone } from "@/lib/format";
import { addOccurrenceVendor } from "@/app/admin/(protected)/events/actions";

const STATUS_OPTIONS = [
  { value: "invited", label: "Invited" },
  { value: "applied", label: "Applied" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved (public)" },
  { value: "declined", label: "Declined" },
];

const STATUS_LABEL: Record<string, string> = {
  invited: "Invited",
  applied: "Applied",
  pending: "Pending",
  approved: "Approved",
  declined: "Declined",
};

const inputClass =
  "rounded-lg border border-black/10 bg-white px-2.5 py-2 text-sm text-ink focus:border-ink/30 focus:outline-none";

interface Row {
  business_id: string;
  business_name: string;
  logo_url: string | null;
  category_name: string | null;
  status: string;
  featured: boolean;
  offering_text: string;
  display_order: string;
}

function toRow(p: EventParticipant): Row {
  return {
    business_id: p.business_id,
    business_name: p.business_name,
    logo_url: p.logo_url,
    category_name: p.category_name,
    status: p.status,
    featured: p.featured,
    offering_text: p.offering_text ?? "",
    display_order: p.display_order != null ? String(p.display_order) : "",
  };
}

function occurrenceLabel(o: EventOccurrence): string {
  return `${formatDateShortInZone(o.start_at, o.timezone)} · ${formatTimeInZone(o.start_at, o.timezone)}–${formatTimeInZone(o.end_at, o.timezone)}`;
}

/**
 * Multi-Occurrence Participating Business pass — occurrence-aware add
 * control, rendered instead of the plain event-level EntitySearchAdd below
 * whenever this event has occurrence rows. Root cause this fixes: adding a
 * business via the plain event-level flow (event_businesses) never asked
 * which date(s) it applies to, and approving it there only ever creates a
 * NON-occurrence appearance (ensureEventAppearance in ../../app/admin/
 * (protected)/events/actions.ts) — but the public event page's "Who
 * You'll Find Here" renders EventOccurrenceBusinessRoster (sourced from
 * event_occurrence_businesses) instead of EventBusinessRoster
 * (event_businesses) for ANY event that has occurrence rows, so that
 * business could never appear there no matter what status it had.
 *
 * This writes directly to event_occurrence_businesses — one row per
 * selected occurrence — via the SAME addOccurrenceVendor action
 * OccurrenceVendorManager's own per-occurrence add already calls; no new
 * table, no new action. A newly added row lands at that table's own
 * column default (status='approved' — an admin-added occurrence vendor is
 * public immediately unless explicitly changed; addOccurrenceVendor syncs
 * the FindMi Here appearance for that default the same way an explicit
 * approval does). Status/Featured/Remove management stays entirely in
 * that date's own vendor list below (OccurrenceVendorManager, inside
 * EventOccurrencesEditor), unchanged.
 */
function OccurrenceAwareAdd({ eventId, occurrences }: { eventId: string; occurrences: EventOccurrence[] }) {
  const [isPending, startTransition] = useTransition();
  const [pending, setPending] = useState<SearchResult | null>(null);
  const singleOccurrenceId = occurrences.length === 1 ? occurrences[0].id : null;
  const [selected, setSelected] = useState<Set<string>>(new Set(singleOccurrenceId ? [singleOccurrenceId] : []));

  const allSelected = occurrences.length > 0 && selected.size === occurrences.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirmAdd() {
    if (!pending || selected.size === 0) return;
    const businessId = pending.value;
    const occurrenceIds = Array.from(selected);
    startTransition(async () => {
      // Sequential, not Promise.all — same reasoning as every other
      // batch-of-server-actions loop in this codebase (MemberGalleryField,
      // GalleryField): keeps this predictable under the dev server's
      // request logging and never risks one occurrence's failure
      // affecting another's — each call is independently idempotent
      // (onConflict: "occurrence_id,business_id", ignoreDuplicates).
      for (const occurrenceId of occurrenceIds) {
        await addOccurrenceVendor(eventId, occurrenceId, businessId);
      }
      setPending(null);
      setSelected(new Set(singleOccurrenceId ? [singleOccurrenceId] : []));
    });
  }

  return (
    <div className="rounded-xl border border-black/10 bg-white p-3">
      <p className="text-xs font-semibold text-ink">Add To Specific Occurrences</p>
      <p className="mt-0.5 text-xs text-ink/45">
        This event has multiple dates — choose which occurrence(s) this business is participating in. Status,
        Featured, and Remove for each date are managed in that date&rsquo;s own vendor list below.
      </p>

      <div className="mt-2">
        <EntitySearchAdd
          entity="businesses"
          placeholder="Search a business to add…"
          excludeIds={new Set()}
          onAdd={(r) => {
            setPending(r);
            setSelected(new Set(singleOccurrenceId ? [singleOccurrenceId] : []));
          }}
        />
      </div>

      {pending && (
        <div className="mt-2.5 rounded-lg border border-black/10 bg-black/[0.02] p-2.5">
          <div className="flex items-center gap-2">
            <Avatar url={pending.image_url ?? null} label={pending.label} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{pending.label}</span>
            <button
              type="button"
              onClick={() => setPending(null)}
              className="shrink-0 text-xs font-semibold text-ink/40 hover:text-ink"
            >
              Cancel
            </button>
          </div>

          {occurrences.length > 1 ? (
            <>
              <p className="mt-2.5 text-xs font-semibold text-ink">Participating Occurrences</p>
              <div className="mt-1.5 flex flex-col gap-1">
                {occurrences.map((o) => (
                  <label key={o.id} className="flex items-center gap-2 text-xs text-ink/80">
                    <input
                      type="checkbox"
                      checked={selected.has(o.id)}
                      onChange={() => toggle(o.id)}
                      className="h-3.5 w-3.5 accent-findmi"
                    />
                    {occurrenceLabel(o)}
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setSelected(allSelected ? new Set() : new Set(occurrences.map((o) => o.id)))}
                className="mt-1.5 text-xs font-semibold text-findmi-700 hover:underline"
              >
                {allSelected ? "Deselect All" : "Select All"}
              </button>
            </>
          ) : (
            // Single-occurrence event — auto-selected above, no checkbox
            // needed (Section 2's "keep the UI simple" requirement).
            <p className="mt-2 text-xs text-ink/60">Date: {occurrences[0] ? occurrenceLabel(occurrences[0]) : "—"}</p>
          )}

          <button
            type="button"
            disabled={isPending || selected.size === 0}
            onClick={confirmAdd}
            className="mt-2.5 w-full rounded-full bg-findmi px-3 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-findmi-600 disabled:opacity-50"
          >
            {isPending ? "Adding…" : "Add Business"}
          </button>
        </div>
      )}
    </div>
  );
}

interface OccurrenceParticipationSummary {
  business_id: string;
  business_name: string;
  logo_url: string | null;
  entries: { occurrenceId: string; label: string; status: string }[];
}

/** Admin-display fix — groups event_occurrence_businesses rows by
 * business (across every occurrence of this event) so the top-level
 * Participating Businesses summary can show ONE entry per business
 * ("Donna C Designs — Participating in 2 occurrences") instead of either
 * nothing (the previous bug: this section only ever read
 * initialParticipants/event_businesses) or duplicate unrelated-looking
 * rows per occurrence. Iterates `occurrences` (not
 * Object.values(vendorRostersByOccurrence)) so entries render in the
 * event's own chronological occurrence order. */
function summarizeOccurrenceParticipation(
  occurrences: EventOccurrence[],
  vendorRostersByOccurrence: Record<string, AdminOccurrenceVendor[]>
): OccurrenceParticipationSummary[] {
  const byBusiness = new Map<string, OccurrenceParticipationSummary>();
  for (const occ of occurrences) {
    for (const vendor of vendorRostersByOccurrence[occ.id] ?? []) {
      const entry = { occurrenceId: occ.id, label: formatDateShortInZone(occ.start_at, occ.timezone), status: vendor.status };
      const existing = byBusiness.get(vendor.business_id);
      if (existing) existing.entries.push(entry);
      else
        byBusiness.set(vendor.business_id, {
          business_id: vendor.business_id,
          business_name: vendor.business_name,
          logo_url: vendor.logo_url,
          entries: [entry],
        });
    }
  }
  return Array.from(byBusiness.values());
}

/** Search-and-add roster editor for one event's participating businesses.
 * Only ever renders rows for businesses actually linked to this event (a
 * handful to a few dozen), never the whole businesses table — adding is a
 * bounded server-side search (see RelationPicker/EntitySearchAdd), and
 * removed rows are tracked separately so the server can delete exactly
 * those relationships without re-fetching every business in the system.
 *
 * Multi-Occurrence Participating Business pass — when this event has
 * occurrence rows, the plain add-a-business control above is replaced by
 * OccurrenceAwareAdd (writes to event_occurrence_businesses, occurrence-
 * specific — see that component's own comment for the full root-cause
 * trace). Events with zero occurrence rows (genuinely non-recurring) are
 * completely unaffected: same add flow, same event_businesses write, same
 * ensureEventAppearance sync as before this pass.
 *
 * Admin-display fix (Event Admin Participating Businesses Display pass) —
 * for an occurrence-bearing event, this section's own "current roster"
 * (the summary + its empty state) is now DERIVED FROM
 * event_occurrence_businesses (via vendorRostersByOccurrence, summarized
 * by summarizeOccurrenceParticipation above), never from
 * initialParticipants/event_businesses — that table is no longer the
 * source of truth for what this section reports as "participating" once
 * an event has occurrences. Read-only here by design: Status/Featured/
 * Remove stay exclusively in each occurrence's own OccurrenceVendorManager
 * (inside EventOccurrencesEditor) — no second management system. Any
 * EXISTING event_businesses rows (legacy, pre-dating occurrence-specific
 * participation) still render below as their own clearly-labeled,
 * fully-editable section — preserved exactly as before, never auto-
 * migrated or deleted. */
export default function ParticipationRoster({
  eventId,
  occurrences,
  vendorRostersByOccurrence,
  initialParticipants,
}: {
  eventId: string | null;
  occurrences: EventOccurrence[];
  vendorRostersByOccurrence: Record<string, AdminOccurrenceVendor[]>;
  initialParticipants: EventParticipant[];
}) {
  const [rows, setRows] = useState<Row[]>(initialParticipants.map(toRow));
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const hasOccurrences = Boolean(eventId) && occurrences.length > 0;
  const occurrenceSummaries = hasOccurrences
    ? summarizeOccurrenceParticipation(occurrences, vendorRostersByOccurrence)
    : [];

  const addBusiness = (r: SearchResult) => {
    setRows((prev) => [
      ...prev,
      {
        business_id: r.value,
        business_name: r.label,
        logo_url: r.image_url ?? null,
        category_name: null,
        status: "invited",
        featured: false,
        offering_text: "",
        display_order: "",
      },
    ]);
    setRemovedIds((prev) => prev.filter((id) => id !== r.value));
  };

  const removeBusiness = (businessId: string) => {
    setRows((prev) => prev.filter((row) => row.business_id !== businessId));
    setRemovedIds((prev) => [...prev, businessId]);
  };

  const updateRow = (businessId: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((row) => (row.business_id === businessId ? { ...row, ...patch } : row)));
  };

  // Legacy event_businesses rows — fully editable exactly as before this
  // pass, rendered under their own heading/note when occurrence-based (see
  // the component doc comment), or as the plain unlabeled roster for a
  // non-occurrence event (unchanged from before this pass).
  const legacyRowsList = (
    <div className="mt-3 flex flex-col gap-2">
      {rows.map((row) => (
        <div key={row.business_id} className="rounded-xl border border-black/10 bg-white p-3">
          <input type="hidden" name="participant_business_id" value={row.business_id} />
          <div className="flex items-center gap-2.5">
            <Avatar url={row.logo_url} label={row.business_name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{row.business_name}</p>
              {row.category_name && <p className="truncate text-xs text-ink/40">{row.category_name}</p>}
            </div>
            <button
              type="button"
              onClick={() => removeBusiness(row.business_id)}
              className="shrink-0 text-xs font-semibold text-red-600 hover:underline"
            >
              Remove
            </button>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <select
              name={`status_${row.business_id}`}
              value={row.status}
              onChange={(e) => updateRow(row.business_id, { status: e.target.value })}
              className={inputClass}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-ink/70">
              <input
                type="checkbox"
                name={`featured_${row.business_id}`}
                checked={row.featured}
                onChange={(e) => updateRow(row.business_id, { featured: e.target.checked })}
                className="h-4 w-4 accent-findmi"
              />
              Featured
            </label>
          </div>

          <div className="mt-2.5 grid gap-2 sm:grid-cols-[1fr_auto]">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink/60">
                What they&rsquo;ll have at this event
              </span>
              <input
                type="text"
                name={`offering_text_${row.business_id}`}
                value={row.offering_text}
                onChange={(e) => updateRow(row.business_id, { offering_text: e.target.value })}
                placeholder="Falls back to their profile description"
                className={`${inputClass} w-full`}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink/60">Order</span>
              <input
                type="number"
                name={`display_order_${row.business_id}`}
                value={row.display_order}
                onChange={(e) => updateRow(row.business_id, { display_order: e.target.value })}
                className={`${inputClass} w-20`}
              />
            </label>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-ink">Participating Businesses</span>

      {hasOccurrences ? (
        <OccurrenceAwareAdd eventId={eventId as string} occurrences={occurrences} />
      ) : (
        <EntitySearchAdd
          entity="businesses"
          placeholder="Search and add business…"
          excludeIds={new Set(rows.map((r) => r.business_id))}
          onAdd={addBusiness}
        />
      )}

      {hasOccurrences ? (
        <>
          {/* Admin-display fix — this summary is the actual source of
              truth for an occurrence-based event: event_occurrence_businesses,
              grouped by business, never event_businesses. */}
          {occurrenceSummaries.length === 0 ? (
            <p className="mt-3 text-sm text-ink/45">No businesses added yet — search above to add one.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {occurrenceSummaries.map((s) => (
                <div key={s.business_id} className="rounded-xl border border-black/10 bg-white p-3">
                  <div className="flex items-center gap-2.5">
                    <Avatar url={s.logo_url} label={s.business_name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{s.business_name}</p>
                      <p className="text-xs text-ink/50">
                        Participating in {s.entries.length} occurrence{s.entries.length === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-col gap-0.5 pl-[2.625rem]">
                    {s.entries.map((entry) => (
                      <p key={entry.occurrenceId} className="text-xs text-ink/60">
                        {entry.label} · <span className="font-medium text-ink">{STATUS_LABEL[entry.status] ?? entry.status}</span>
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-1.5 text-xs text-ink/40">
            Status, Featured, and Remove for each date are managed in that date&rsquo;s own vendor list below.
          </p>

          {rows.length > 0 && (
            <div className="mt-5 border-t border-black/10 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">
                Legacy Event-Level Participation
              </p>
              <p className="mt-1 text-xs text-amber-700">
                These businesses were added before this event had specific dates (or before occurrence-specific
                participation existed) — they won&rsquo;t appear in &ldquo;Who You&rsquo;ll Find Here&rdquo; for any
                date. Remove and re-add them above with the correct occurrence(s) if they should be shown.
              </p>
              {legacyRowsList}
            </div>
          )}
        </>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink/45">No businesses added yet — search above to add one.</p>
      ) : (
        legacyRowsList
      )}

      {removedIds.map((id) => (
        <input key={id} type="hidden" name="removed_business_id" value={id} />
      ))}

      <p className="mt-1.5 text-xs text-ink/45">
        Only &ldquo;Approved&rdquo; businesses appear publicly on the event page.
      </p>
    </div>
  );
}
