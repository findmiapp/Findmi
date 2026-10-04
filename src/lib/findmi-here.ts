/** Public Business V2 — Findmi Here presentation model.
 *
 * A pure, presentation-layer grouping of a Business's already-fetched
 * Appearance rows into the experiences a consumer perceives as ONE thing:
 *
 *   - Event-backed appearances are grouped by event_id (authoritative —
 *     never by title), so a 12-date Event is one item whose schedule lives
 *     on the Event page.
 *   - Standalone appearances stay individual (never merged, even when two
 *     share a title).
 *
 * Then split into Happening Now (genuinely live: start <= now < end, with a
 * real end time — never inferred), Upcoming, and Past. No schema or data
 * changes; nothing here writes. */

export interface HereAppearanceLike {
  id: string;
  event_id: string | null;
  title: string;
  start_at: string;
  end_at: string | null;
  event?: { slug: string; name?: string; cover_image_url?: string | null } | null;
}

export interface HereItem<A extends HereAppearanceLike> {
  key: string;
  kind: "event" | "single";
  /** The Event's own name for an Event group; the appearance title otherwise. */
  title: string;
  eventSlug: string | null;
  /** Chronological (earliest first). */
  appearances: A[];
  /** The appearance that represents the item right now: the live one, else
   * the next upcoming one, else (past) the most recent one. */
  lead: A;
  firstStart: string;
  lastEnd: string;
}

export function isLiveNow(a: { start_at: string; end_at: string | null }, now: number): boolean {
  if (!a.end_at) return false;
  return new Date(a.start_at).getTime() <= now && new Date(a.end_at).getTime() > now;
}

function groupKey(a: HereAppearanceLike): string {
  return a.event_id && a.event?.slug ? `event:${a.event_id}` : `appearance:${a.id}`;
}

function toItems<A extends HereAppearanceLike>(rows: A[], pickLead: (sorted: A[]) => A): HereItem<A>[] {
  const groups = new Map<string, A[]>();
  for (const row of rows) {
    const key = groupKey(row);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  const items: HereItem<A>[] = [];
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => a.start_at.localeCompare(b.start_at));
    const lead = pickLead(sorted);
    const isEvent = key.startsWith("event:");
    const last = sorted[sorted.length - 1];
    items.push({
      key,
      kind: isEvent ? "event" : "single",
      title: isEvent ? lead.event?.name?.trim() || lead.title : lead.title,
      eventSlug: isEvent ? (lead.event?.slug ?? null) : null,
      appearances: sorted,
      lead,
      firstStart: sorted[0].start_at,
      lastEnd: last.end_at ?? last.start_at,
    });
  }
  return items;
}

export type SpotlightState = "featured" | "now" | "next" | "recent";

export interface FindmiHereModel<A extends HereAppearanceLike> {
  /** The one experience promoted into the large card at the top of Findmi
   * Here: the featured item while eligible, else what's live, else the next
   * upcoming one, else (nothing current) the most recent past one. It is
   * removed from its own group below, so it never renders twice. */
  spotlight: { item: HereItem<A>; state: SpotlightState; live: boolean } | null;
  now: HereItem<A>[];
  upcoming: HereItem<A>[];
  past: HereItem<A>[];
}

/**
 * `upcoming` — getUpcomingAppearancesForBusiness rows (end_at > now).
 * `past` — getPastAppearancesForBusiness rows (end_at <= now).
 * `featuredAppearanceId` — businesses.featured_appearance_id: when it is
 * still in the eligible upcoming set, its item leads Upcoming (or is simply
 * already in Happening Now). Once it drops out, ordering falls back to
 * chronological — same "silently fall back" rule as before.
 */
export function buildFindmiHere<A extends HereAppearanceLike>({
  upcoming,
  past,
  featuredAppearanceId,
  now = Date.now(),
}: {
  upcoming: A[];
  past: A[];
  featuredAppearanceId: string | null;
  now?: number;
}): FindmiHereModel<A> {
  const current = toItems(upcoming, (sorted) => sorted.find((a) => isLiveNow(a, now)) ?? sorted.find((a) => new Date(a.start_at).getTime() > now) ?? sorted[0]);

  const nowItems = current
    .filter((item) => item.appearances.some((a) => isLiveNow(a, now)))
    .sort((a, b) => a.lead.start_at.localeCompare(b.lead.start_at));
  const nowKeys = new Set(nowItems.map((i) => i.key));
  const upcomingItems = current.filter((i) => !nowKeys.has(i.key)).sort((a, b) => a.lead.start_at.localeCompare(b.lead.start_at));

  if (featuredAppearanceId) {
    const idx = upcomingItems.findIndex((i) => i.appearances.some((a) => a.id === featuredAppearanceId));
    if (idx > 0) upcomingItems.unshift(...upcomingItems.splice(idx, 1));
  }

  // Past: grouped the same way, most recent first, minus any Event that is
  // still current/upcoming (its page already carries that history).
  const currentKeys = new Set(current.map((i) => i.key));
  const pastItems = toItems(past, (sorted) => sorted[sorted.length - 1])
    .filter((i) => !currentKeys.has(i.key))
    .sort((a, b) => b.lastEnd.localeCompare(a.lastEnd));

  // Spotlight selection: featured (eligible) → live → next → most recent.
  let spotlight: FindmiHereModel<A>["spotlight"] = null;
  const featuredIn = (list: HereItem<A>[]) =>
    featuredAppearanceId ? list.findIndex((i) => i.appearances.some((a) => a.id === featuredAppearanceId)) : -1;
  const take = (list: HereItem<A>[], idx: number) => list.splice(idx, 1)[0];
  if (featuredIn(nowItems) >= 0) {
    spotlight = { item: take(nowItems, featuredIn(nowItems)), state: "featured", live: true };
  } else if (featuredIn(upcomingItems) >= 0) {
    spotlight = { item: take(upcomingItems, featuredIn(upcomingItems)), state: "featured", live: false };
  } else if (nowItems.length > 0) {
    spotlight = { item: take(nowItems, 0), state: "now", live: true };
  } else if (upcomingItems.length > 0) {
    spotlight = { item: take(upcomingItems, 0), state: "next", live: false };
  } else if (pastItems.length > 0) {
    spotlight = { item: take(pastItems, 0), state: "recent", live: false };
  }

  return { spotlight, now: nowItems, upcoming: upcomingItems, past: pastItems };
}
