"use client";

import { useState } from "react";
import { Avatar, EntitySearchAdd, type SearchResult } from "./RelationPicker";
import type { PersonBusinessRow } from "@/lib/admin/people-queries";

const inputClass =
  "rounded-lg border border-black/10 bg-white px-2.5 py-2 text-sm text-ink focus:border-ink/30 focus:outline-none";

interface Row {
  business_id: string;
  business_name: string;
  logo_url: string | null;
  role: string;
  display_order: string;
  featured: boolean;
  show_on_business: boolean;
}

function toRow(p: PersonBusinessRow): Row {
  return {
    business_id: p.business_id,
    business_name: p.business_name,
    logo_url: p.logo_url,
    role: p.role ?? "",
    display_order: p.display_order != null ? String(p.display_order) : "",
    featured: p.featured,
    show_on_business: p.show_on_business,
  };
}

/** Search-and-add roster of the businesses one person is associated with —
 * mirrors ParticipationRoster's event/business pattern exactly, swapped to
 * person/business. Role is set PER BUSINESS since the same person can be
 * "Founder" at one brand and "Advisor" at another. */
export default function PersonBusinessRoster({
  initialBusinesses,
}: {
  initialBusinesses: PersonBusinessRow[];
}) {
  const [rows, setRows] = useState<Row[]>(initialBusinesses.map(toRow));
  const [removedIds, setRemovedIds] = useState<string[]>([]);

  const addBusiness = (r: SearchResult) => {
    setRows((prev) => [
      ...prev,
      {
        business_id: r.value,
        business_name: r.label,
        logo_url: r.image_url ?? null,
        role: "",
        display_order: "",
        featured: false,
        show_on_business: true,
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
      <span className="mb-1.5 block text-sm font-medium text-ink">Associated Businesses</span>

      <EntitySearchAdd
        entity="businesses"
        placeholder="Search and add business…"
        excludeIds={new Set(rows.map((r) => r.business_id))}
        onAdd={addBusiness}
      />

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink/45">Not linked to any business yet — search above to add one.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {rows.map((row) => (
            <div key={row.business_id} className="rounded-xl border border-black/10 bg-white p-3">
              <input type="hidden" name="business_id" value={row.business_id} />
              <div className="flex items-center gap-2.5">
                <Avatar url={row.logo_url} label={row.business_name} />
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{row.business_name}</p>
                <button
                  type="button"
                  onClick={() => removeBusiness(row.business_id)}
                  className="shrink-0 text-xs font-semibold text-red-600 hover:underline"
                >
                  Remove
                </button>
              </div>

              <div className="mt-2.5 grid gap-2 sm:grid-cols-[1fr_auto]">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-ink/60">Role / Title at this business</span>
                  <input
                    type="text"
                    name={`role_${row.business_id}`}
                    value={row.role}
                    onChange={(e) => updateRow(row.business_id, { role: e.target.value })}
                    placeholder="e.g. Founder, Head Chef, Co-Owner"
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

              <div className="mt-2.5 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-ink/70">
                  <input
                    type="checkbox"
                    name={`show_on_business_${row.business_id}`}
                    checked={row.show_on_business}
                    onChange={(e) => updateRow(row.business_id, { show_on_business: e.target.checked })}
                    className="h-4 w-4 accent-findmi"
                  />
                  Show on business profile
                </label>
                <label className="flex items-center gap-1.5 text-xs text-ink/70">
                  <input
                    type="checkbox"
                    name={`featured_${row.business_id}`}
                    checked={row.featured}
                    onChange={(e) => updateRow(row.business_id, { featured: e.target.checked })}
                    className="h-4 w-4 accent-findmi"
                  />
                  Featured on that profile
                </label>
              </div>
            </div>
          ))}
        </div>
      )}

      {removedIds.map((id) => (
        <input key={id} type="hidden" name="removed_business_id" value={id} />
      ))}
    </div>
  );
}
