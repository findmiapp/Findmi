"use client";

import Link from "next/link";
import AdminBulkList from "@/components/admin/AdminBulkList";
import EventBulkActionBar from "./EventBulkActionBar";
import { hideEvent, publishEvent, shutDownEvent } from "./lifecycle-actions";
import type { AdminEvent } from "@/lib/admin/queries";
import type { Category } from "@/lib/types";
import { formatDateRange, formatDateShort } from "@/lib/format";
import { EVENT_VISIBILITY_LABEL, eventVisibility } from "@/lib/event-publication";

const NEW_EVENTS_LIST = "/admin/events?new=1";

/** Admin status badge — PUBLISHED / DRAFT / ARCHIVED / TRASHED (the shared
 * Admin lifecycle vocabulary); the moderation flags "Needs Review" /
 * "Rejected" only ever appear on Events created before Events went live by
 * default. Rows in the New Events VIEW show their real state, never "New". */
export function eventStatusBadge(e: Pick<AdminEvent, "is_demo" | "publication_status" | "archived_at" | "trashed_at">): { label: string; className: string } {
  const visibility = eventVisibility(e);
  if (visibility === "hidden" && e.publication_status === "pending_review") return { label: "Needs Review", className: "bg-amber-100 text-amber-800" };
  if (visibility === "hidden" && e.publication_status === "rejected") return { label: "Rejected", className: "bg-red-50 text-red-700" };
  return {
    label: EVENT_VISIBILITY_LABEL[visibility],
    className: visibility === "live" ? "bg-findmi-50 text-findmi-700" : visibility === "archived" ? "bg-red-50 text-red-700" : "bg-black/[0.06] text-ink/50",
  };
}

export default function EventBulkListClient({
  events,
  view,
  categories,
}: {
  events: AdminEvent[];
  // No "paused" view — events have no Pause concept (see
  // lifecycle-actions.ts's note on the DB CHECK constraint). "new" is the
  // New Events oversight view.
  view: "active" | "archived" | "trashed" | "other" | "new";
  categories: Category[];
}) {
  const oversight = view === "new";
  return (
    <AdminBulkList
      items={events}
      emptyMessage={oversight ? "No Events created in the last few days." : "No events in this view."}
      renderBulkBar={(selectedIds, _clear, keepSelected) => (
        <EventBulkActionBar
          view={oversight ? "other" : view}
          selectedIds={selectedIds}
          categories={categories}
          selectedRows={events.filter((e) => selectedIds.includes(e.id))}
          keepSelected={keepSelected}
        />
      )}
      renderRow={(e, selected, toggle) => {
        const badge = eventStatusBadge(e);
        const visibility = eventVisibility(e);
        return (
          <div key={e.id} className="flex items-start gap-3 rounded-xl border border-black/5 bg-white px-4 py-3 transition hover:border-black/10">
            <input type="checkbox" checked={selected} onChange={toggle} className="mt-0.5 h-5 w-5 shrink-0" aria-label={`Select ${e.name}`} />
            <div className="min-w-0 flex-1">
              <Link href={`/admin/events/${e.id}`} className="block min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{e.name}</p>
                <p className="truncate text-xs text-ink/45">{formatDateRange(e.start_at, e.end_at)}</p>
                {oversight && (
                  <p className="truncate text-[11px] text-ink/45">
                    Added {formatDateShort(e.created_at)}
                    {e.venue_name ? ` · ${e.venue_name}` : e.city ? ` · ${e.city}` : ""}
                  </p>
                )}
                {e.archived_at && <p className="truncate text-[11px] text-ink/40">Archived {formatDateShort(e.archived_at)}</p>}
                {e.trashed_at && <p className="truncate text-[11px] text-ink/40">Trashed {formatDateShort(e.trashed_at)}</p>}
              </Link>
              {oversight && (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs font-semibold">
                  {visibility === "live" && (
                    <Link href={`/event/${e.slug}`} target="_blank" className="text-findmi-700 hover:underline">
                      View
                    </Link>
                  )}
                  <Link href={`/admin/events/${e.id}`} className="text-ink/70 hover:underline">
                    Edit
                  </Link>
                  {visibility === "live" && (
                    <form action={hideEvent.bind(null, e.id, NEW_EVENTS_LIST)}>
                      <button type="submit" className="text-ink/70 hover:underline">
                        Unpublish
                      </button>
                    </form>
                  )}
                  {visibility === "hidden" && (
                    <form action={publishEvent.bind(null, e.id, NEW_EVENTS_LIST)}>
                      <button type="submit" className="text-findmi-700 hover:underline">
                        Publish
                      </button>
                    </form>
                  )}
                  {(visibility === "live" || visibility === "hidden") && (
                    <form action={shutDownEvent.bind(null, e.id, NEW_EVENTS_LIST)}>
                      <button type="submit" className="text-red-700 hover:underline">
                        Archive
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${badge.className}`}>{badge.label}</span>
          </div>
        );
      }}
    />
  );
}
