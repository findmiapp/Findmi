"use client";

import Link from "next/link";
import AdminBulkList from "@/components/admin/AdminBulkList";
import BusinessBulkActionBar from "./BusinessBulkActionBar";
import type { AdminBusiness } from "@/lib/admin/queries";
import type { Category } from "@/lib/types";
import { formatDateShort } from "@/lib/format";

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
      renderBulkBar={(selectedIds) => <BusinessBulkActionBar view={view} selectedIds={selectedIds} categories={categories} />}
      renderRow={(b, selected, toggle) => (
        <div
          key={b.id}
          className="flex items-center gap-3 rounded-xl border border-black/5 bg-white px-4 py-3 transition hover:border-black/10"
        >
          <input type="checkbox" checked={selected} onChange={toggle} className="h-4 w-4 shrink-0" aria-label={`Select ${b.name}`} />
          <Link href={`/admin/businesses/${b.id}`} className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{b.name}</p>
            <p className="truncate text-xs text-ink/45">{[b.city, b.state].filter(Boolean).join(", ") || b.slug}</p>
            {b.archived_at && <p className="truncate text-[11px] text-ink/40">Archived {formatDateShort(b.archived_at)}</p>}
            {b.trashed_at && <p className="truncate text-[11px] text-ink/40">Trashed {formatDateShort(b.trashed_at)}</p>}
          </Link>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
              b.is_demo
                ? "bg-black/[0.06] text-ink/50"
                : b.publication_status === "pending_review"
                  ? "bg-amber-50 text-amber-700"
                  : b.publication_status === "paused"
                    ? "bg-black/[0.06] text-ink/50"
                    : b.publication_status === "rejected"
                      ? "bg-red-50 text-red-700"
                      : "bg-findmi-50 text-findmi-700"
            }`}
          >
            {b.is_demo
              ? "Demo"
              : b.publication_status === "pending_review"
                ? "Pending Review"
                : b.publication_status === "paused"
                  ? "Paused"
                  : b.publication_status === "rejected"
                    ? "Rejected"
                    : "Public"}
          </span>
        </div>
      )}
    />
  );
}
