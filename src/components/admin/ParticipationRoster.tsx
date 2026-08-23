"use client";

import { useState } from "react";
import { Avatar, EntitySearchAdd, type SearchResult } from "./RelationPicker";
import type { EventParticipant } from "@/lib/admin/queries";

const STATUS_OPTIONS = [
  { value: "invited", label: "Invited" },
  { value: "applied", label: "Applied" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved (public)" },
  { value: "declined", label: "Declined" },
];

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

/** Search-and-add roster editor for one event's participating businesses.
 * Only ever renders rows for businesses actually linked to this event (a
 * handful to a few dozen), never the whole businesses table — adding is a
 * bounded server-side search (see RelationPicker/EntitySearchAdd), and
 * removed rows are tracked separately so the server can delete exactly
 * those relationships without re-fetching every business in the system. */
export default function ParticipationRoster({
  initialParticipants,
}: {
  initialParticipants: EventParticipant[];
}) {
  const [rows, setRows] = useState<Row[]>(initialParticipants.map(toRow));
  const [removedIds, setRemovedIds] = useState<string[]>([]);

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

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-ink">Participating Businesses</span>

      <EntitySearchAdd
        entity="businesses"
        placeholder="Search and add business…"
        excludeIds={new Set(rows.map((r) => r.business_id))}
        onAdd={addBusiness}
      />

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink/45">No businesses added yet — search above to add one.</p>
      ) : (
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
