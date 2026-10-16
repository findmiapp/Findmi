"use client";

import Link from "next/link";
import AdminBulkList from "@/components/admin/AdminBulkList";
import BusinessBulkActionBar from "./BusinessBulkActionBar";
import type { AdminBusiness } from "@/lib/admin/queries";
import type { Category } from "@/lib/types";
import { formatDateShort } from "@/lib/format";
import { businessBadge } from "@/lib/admin/lifecycle-eligibility";

export default function BusinessBulkListClient({
  businesses,
  view,
  categories,
}: {
  businesses: AdminBusiness[];
  view: "active" | "paused" | "archived" | "trashed" | "other";
  categories: Category[];
}) {
  return (
    <AdminBulkList
      items={businesses}
      emptyMessage="No businesses in this view."
      renderBulkBar={(selectedIds, _clear, keepSelected) => (
        <BusinessBulkActionBar
          view={view}
          selectedIds={selectedIds}
          categories={categories}
          selectedRows={businesses.filter((b) => selectedIds.includes(b.id))}
          keepSelected={keepSelected}
        />
      )}
      renderRow={(b, selected, toggle) => (
        <div
          key={b.id}
          className="flex items-center gap-3 rounded-xl border border-black/5 bg-white px-4 py-3 transition hover:border-black/10"
        >
          <input type="checkbox" checked={selected} onChange={toggle} className="h-5 w-5 shrink-0" aria-label={`Select ${b.name}`} />
          <Link href={`/admin/businesses/${b.id}`} className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{b.name}</p>
            <p className="truncate text-xs text-ink/45">{[b.city, b.state].filter(Boolean).join(", ") || b.slug}</p>
            {b.archived_at && <p className="truncate text-[11px] text-ink/40">Archived {formatDateShort(b.archived_at)}</p>}
            {b.trashed_at && <p className="truncate text-[11px] text-ink/40">Trashed {formatDateShort(b.trashed_at)}</p>}
          </Link>
          {/* Lifecycle badge from the existing columns (lib/admin/lifecycle-eligibility.ts businessBadge). */}
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${businessBadge(b).className}`}>{businessBadge(b).label}</span>
        </div>
      )}
    />
  );
}
