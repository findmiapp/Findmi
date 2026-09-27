"use client";

import Link from "next/link";
import AdminBulkList from "@/components/admin/AdminBulkList";
import EventBulkActionBar from "./EventBulkActionBar";
import type { AdminEvent } from "@/lib/admin/queries";
import type { Category } from "@/lib/types";
import { formatDateRange, formatDateShort } from "@/lib/format";

export default function EventBulkListClient({
  events,
  view,
  categories,
}: {
  events: AdminEvent[];
  // No "paused" view — events have no Pause concept (see
  // lifecycle-actions.ts's note on the DB CHECK constraint).
  view: "active" | "archived" | "trashed" | "other";
  categories: Category[];
}) {
  return (
    <AdminBulkList
      items={events}
      emptyMessage="No events in this view."
      renderBulkBar={(selectedIds) => <EventBulkActionBar view={view} selectedIds={selectedIds} categories={categories} />}
      renderRow={(e, selected, toggle) => {
        // Event Rejection State pass's badge logic, unchanged — Archived/
        // Trashed are shown as separate date lines below (Events have no
        // Paused state; publication_status remains the authoritative
        // source for Live/In Review/Rejected exactly as before V2).
        const status = !e.is_demo
          ? "Live"
          : e.publication_status === "pending_review"
            ? "In Review"
            : e.publication_status === "rejected"
              ? "Rejected"
              : "Demo";
        const statusClass =
          status === "Live"
            ? "bg-findmi-50 text-findmi-700"
            : status === "In Review"
              ? "bg-amber-100 text-amber-800"
              : status === "Rejected"
                ? "bg-red-50 text-red-700"
                : "bg-black/[0.06] text-ink/50";
        return (
          <div
            key={e.id}
            className="flex items-center gap-3 rounded-xl border border-black/5 bg-white px-4 py-3 transition hover:border-black/10"
          >
            <input type="checkbox" checked={selected} onChange={toggle} className="h-4 w-4 shrink-0" aria-label={`Select ${e.name}`} />
            <Link href={`/admin/events/${e.id}`} className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{e.name}</p>
              <p className="truncate text-xs text-ink/45">{formatDateRange(e.start_at, e.end_at)}</p>
              {e.archived_at && <p className="truncate text-[11px] text-ink/40">Archived {formatDateShort(e.archived_at)}</p>}
              {e.trashed_at && <p className="truncate text-[11px] text-ink/40">Trashed {formatDateShort(e.trashed_at)}</p>}
            </Link>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${statusClass}`}>
              {status}
            </span>
          </div>
        );
      }}
    />
  );
}
