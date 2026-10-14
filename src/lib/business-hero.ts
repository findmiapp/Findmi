// Business public profile — which ONE upcoming item leads the page.
// Two separate concepts, never merged:
//   - the Business's OWN pick: businesses.featured_appearance_id;
//   - Findmi's EDITORIAL pick: events.is_featured (+ featured_sort_order)
//     on an Event this Business is an APPROVED participant in.
// Precedence: Business pick → Findmi Featured Event → Happening Now →
// nearest upcoming. Featuring never implies hosting or ownership.

/** A Findmi-Featured Event this Business is an approved participant in
 * (public: not hidden, archived or trashed — the caller's query decides). */
export interface EditorialFeaturedEvent {
  eventId: string;
  sortOrder: number | null;
}

export type BusinessHeroReason = "business" | "findmi_featured" | "live" | "nearest";

/** `appearances` are this Business's upcoming items (already eligible and
 * sorted soonest first); anything ended is ignored here as well. */
export function resolveBusinessHero<A extends { id: string; event_id: string | null; start_at: string; end_at: string | null }>(
  appearances: A[],
  { overrideId, featuredEvents, now = Date.now() }: { overrideId: string | null; featuredEvents: EditorialFeaturedEvent[]; now?: number }
): { item: A; reason: BusinessHeroReason } | null {
  const upcoming = appearances.filter((a) => Date.parse(a.end_at ?? a.start_at) > now);
  if (upcoming.length === 0) return null;

  if (overrideId) {
    const own = upcoming.find((a) => a.id === overrideId);
    if (own) return { item: own, reason: "business" };
  }

  const order = new Map(featuredEvents.map((f) => [f.eventId, f.sortOrder]));
  const featured = upcoming
    .filter((a) => a.event_id && order.has(a.event_id))
    .sort((a, b) => {
      const ao = order.get(a.event_id!) ?? Number.POSITIVE_INFINITY;
      const bo = order.get(b.event_id!) ?? Number.POSITIVE_INFINITY;
      return ao !== bo ? ao - bo : a.start_at.localeCompare(b.start_at);
    });
  if (featured[0]) return { item: featured[0], reason: "findmi_featured" };

  const live = upcoming.find((a) => Date.parse(a.start_at) <= now);
  if (live) return { item: live, reason: "live" };
  return { item: [...upcoming].sort((a, b) => a.start_at.localeCompare(b.start_at))[0], reason: "nearest" };
}

/** Which Events can lend Findmi's editorial feature to THIS Business: only
 * public (not hidden, archived or trashed) Events marked is_featured that
 * the Business is an APPROVED participant in. Participation alone never
 * features anything; featuring never implies hosting. */
export function editorialFeaturedEventsFor(
  events: Iterable<{ id: string; is_featured?: boolean | null; featured_sort_order?: number | null; is_demo?: boolean | null; archived_at?: string | null; trashed_at?: string | null }>,
  approvedEventIds: ReadonlySet<string>
): EditorialFeaturedEvent[] {
  return [...events]
    .filter((e) => e.is_featured === true && !e.is_demo && !e.archived_at && !e.trashed_at && approvedEventIds.has(e.id))
    .map((e) => ({ eventId: e.id, sortOrder: e.featured_sort_order ?? null }));
}
