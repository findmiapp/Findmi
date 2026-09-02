"use client";

import { useState, useTransition } from "react";
import { Avatar, EntitySearchAdd, type SearchResult } from "./RelationPicker";
import type { AdminOccurrenceVendor } from "@/lib/admin/queries";
import type { EventParticipationStatus } from "@/lib/types";
import {
  addOccurrenceVendor,
  copyOccurrenceVendors,
  removeOccurrenceVendor,
  updateOccurrenceVendorFeatured,
  updateOccurrenceVendorStatus,
} from "@/app/admin/(protected)/events/actions";

const STATUS_OPTIONS: { value: EventParticipationStatus; label: string }[] = [
  { value: "invited", label: "Invited" },
  { value: "applied", label: "Applied" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved (public)" },
  { value: "declined", label: "Declined" },
];

const inputClass =
  "rounded-lg border border-black/10 bg-white px-2 py-1.5 text-xs text-ink focus:border-ink/30 focus:outline-none";

/**
 * Manages ONE occurrence's own vendor roster (event_occurrence_businesses)
 * — completely independent of the parent event's roster
 * (event_businesses / ParticipationRoster above it on this same form) and
 * never auto-copied either direction. Every mutation here is an immediate,
 * direct Server Action call wrapped in startTransition, not a <form>: this
 * renders inside an occurrence row in EventOccurrencesEditor, which itself
 * already sits inside EventForm's outer <form action={saveEvent}>, and a
 * nested <form> would be invalid HTML. Same direct-call pattern already
 * used for FulfillmentStatusToggle in the orders admin — on success the
 * action only revalidates the current path, so this panel's open/closed
 * state (owned by the parent EventOccurrencesEditor) is never reset by a
 * navigation.
 */
export default function OccurrenceVendorManager({
  eventId,
  occurrenceId,
  vendors,
  copySources,
}: {
  eventId: string;
  occurrenceId: string;
  vendors: AdminOccurrenceVendor[];
  /** Other already-saved occurrences on this same event, for Copy
   * Vendors — never includes this occurrence itself. */
  copySources: { id: string; label: string }[];
}) {
  const [isPending, startTransition] = useTransition();
  const [copyFrom, setCopyFrom] = useState("");

  return (
    <div className="mt-2.5 rounded-lg border border-dashed border-black/15 bg-black/[0.015] p-2.5">
      <p className="text-xs font-semibold text-ink">Vendors for This Date</p>
      <p className="mb-2 text-[11px] text-ink/45">
        This date&rsquo;s own roster — separate from &ldquo;Participating Businesses&rdquo; below, and never copied
        from it.
      </p>

      {copySources.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <select
            value={copyFrom}
            disabled={isPending}
            onChange={(e) => setCopyFrom(e.target.value)}
            className={inputClass}
            aria-label="Copy vendors from another date"
          >
            <option value="">Copy vendors from…</option>
            {copySources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={isPending || !copyFrom}
            onClick={() => {
              const sourceId = copyFrom;
              startTransition(() => {
                copyOccurrenceVendors(eventId, occurrenceId, sourceId);
              });
            }}
            className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-black/[0.02] disabled:opacity-50"
          >
            Copy
          </button>
          <span className="text-[11px] text-ink/40">Adds missing vendors only — never overwrites this date&rsquo;s own rows.</span>
        </div>
      )}

      <EntitySearchAdd
        entity="businesses"
        placeholder="Search and add a business…"
        excludeIds={new Set(vendors.map((v) => v.business_id))}
        onAdd={(r: SearchResult) => {
          startTransition(() => {
            addOccurrenceVendor(eventId, occurrenceId, r.value);
          });
        }}
      />

      {vendors.length === 0 ? (
        <p className="mt-2.5 text-xs text-ink/45">No vendors added for this date yet.</p>
      ) : (
        <div className="mt-2.5 flex flex-col gap-1.5">
          {vendors.map((v) => (
            <div
              key={v.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-black/10 bg-white p-2"
            >
              <Avatar url={v.logo_url} label={v.business_name} />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{v.business_name}</span>

              <select
                value={v.status}
                disabled={isPending}
                onChange={(e) => {
                  const status = e.target.value as EventParticipationStatus;
                  startTransition(() => {
                    updateOccurrenceVendorStatus(eventId, occurrenceId, v.id, status);
                  });
                }}
                className={inputClass}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>

              <label className="flex items-center gap-1 text-[11px] text-ink/70">
                <input
                  type="checkbox"
                  checked={v.featured}
                  disabled={isPending}
                  onChange={(e) => {
                    const featured = e.target.checked;
                    startTransition(() => {
                      updateOccurrenceVendorFeatured(eventId, occurrenceId, v.id, featured);
                    });
                  }}
                  className="h-3.5 w-3.5 accent-findmi"
                />
                Featured
              </label>

              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  startTransition(() => {
                    removeOccurrenceVendor(eventId, occurrenceId, v.id);
                  });
                }}
                className="shrink-0 text-[11px] font-semibold text-red-600 hover:underline disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
