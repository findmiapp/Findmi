"use client";

import Link from "next/link";
import AdminBulkList from "@/components/admin/AdminBulkList";
import LocationBulkActionBar from "./LocationBulkActionBar";
import type { AdminLocation } from "@/lib/admin/queries";
import type { Category } from "@/lib/types";
import { cityState, formatDateShort } from "@/lib/format";
import { LOCATION_LIFECYCLE_LABEL, LOCATION_LIFECYCLE_TONE, locationLifecycleState } from "@/lib/admin/location-lifecycle";

export default function LocationBulkListClient({
  locations,
  view,
  categories,
}: {
  locations: AdminLocation[];
  view: "active" | "archived" | "trashed" | "other";
  categories: Category[];
}) {
  return (
    <AdminBulkList
      items={locations}
      emptyMessage="No locations in this view."
      renderBulkBar={(selectedIds, _clear, keepSelected) => <LocationBulkActionBar view={view} selectedIds={selectedIds} categories={categories} keepSelected={keepSelected} />}
      renderRow={(l, selected, toggle) => (
        <div
          key={l.id}
          className="flex items-center gap-3 rounded-xl border border-black/5 bg-white px-4 py-3 transition hover:border-black/10"
        >
          <input type="checkbox" checked={selected} onChange={toggle} className="h-5 w-5 shrink-0" aria-label={`Select ${l.name}`} />
          <Link href={`/admin/locations/${l.id}`} className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{l.name}</p>
            <p className="truncate text-xs text-ink/45">
              {[l.address, cityState(l.city, l.state)].filter(Boolean).join(" · ") || l.slug}
            </p>
            {l.archived_at && <p className="truncate text-[11px] text-ink/40">Archived {formatDateShort(l.archived_at)}</p>}
            {l.trashed_at && <p className="truncate text-[11px] text-ink/40">Trashed {formatDateShort(l.trashed_at)}</p>}
          </Link>
          {/* Lifecycle badge from the canonical columns: PUBLISHED / DRAFT /
              ARCHIVED / TRASHED (lib/admin/location-lifecycle.ts). */}
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${LOCATION_LIFECYCLE_TONE[locationLifecycleState(l)]}`}>
            {LOCATION_LIFECYCLE_LABEL[locationLifecycleState(l)]}
          </span>
        </div>
      )}
    />
  );
}
