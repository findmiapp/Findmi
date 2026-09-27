"use client";

import Link from "next/link";
import AdminBulkList from "@/components/admin/AdminBulkList";
import LocationBulkActionBar from "./LocationBulkActionBar";
import type { AdminLocation } from "@/lib/admin/queries";
import type { Category } from "@/lib/types";
import { cityState, formatDateShort } from "@/lib/format";

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
      renderBulkBar={(selectedIds) => <LocationBulkActionBar view={view} selectedIds={selectedIds} categories={categories} />}
      renderRow={(l, selected, toggle) => (
        <div
          key={l.id}
          className="flex items-center gap-3 rounded-xl border border-black/5 bg-white px-4 py-3 transition hover:border-black/10"
        >
          <input type="checkbox" checked={selected} onChange={toggle} className="h-4 w-4 shrink-0" aria-label={`Select ${l.name}`} />
          <Link href={`/admin/locations/${l.id}`} className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{l.name}</p>
            <p className="truncate text-xs text-ink/45">
              {[l.address, cityState(l.city, l.state)].filter(Boolean).join(" · ") || l.slug}
            </p>
            {l.archived_at && <p className="truncate text-[11px] text-ink/40">Archived {formatDateShort(l.archived_at)}</p>}
            {l.trashed_at && <p className="truncate text-[11px] text-ink/40">Trashed {formatDateShort(l.trashed_at)}</p>}
          </Link>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
              l.is_demo ? "bg-black/[0.06] text-ink/50" : "bg-findmi-50 text-findmi-700"
            }`}
          >
            {l.is_demo ? "Demo" : "Public"}
          </span>
        </div>
      )}
    />
  );
}
