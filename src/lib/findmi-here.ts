/** Findmi Here — Appearance COUNTING vs PRESENTATION GROUPING. Pure;
 * nothing here queries or writes. Two deliberately separate operations:
 *
 * 1. COUNTING — an Appearance is a Business showing up at a particular
 *    date/time/place: one canonical dated Appearance row. Callers first
 *    normalize a Business's rows (lib/data.ts reconcileBusinessActivity /
 *    dedupeAppearances: canceled rows excluded, an Event-level Primary Date
 *    projection superseded by its occurrence-linked dated rows dropped,
 *    true duplicates/range mirrors dropped); every remaining upcoming row
 *    is one Appearance. Distinct occurrence-linked rows of the same Event
 *    are distinct Appearances — never collapsed by event_id, title or
 *    inferred "runs". See countUpcomingAppearances.
 *
 * 2. PRESENTATION GROUPING — an EVENT is the umbrella program. A surface
 *    that wants compact presentation (Business-card preview, Featured
 *    Appearance, Account Home) may show one entry per Event with "+ N More
 *    Dates" instead of a wall of repetitive dates. That entry still
 *    REPRESENTS N+1 Appearances; grouping never changes a count. Standalone
 *    Appearances (no Event) are never grouped. See groupAppearancesForPreview.
 *
 * DATE / SCHEDULE surfaces (Business Upcoming Schedule, Event Upcoming
 * Dates, calendars) use neither grouping — they list every date. */

export interface DatedAppearance {
  id: string;
  event_id: string | null;
  start_at: string;
  end_at: string | null;
}

/** Canonical count: one per normalized upcoming dated Appearance row. */
export function countUpcomingAppearances(normalizedUpcomingRows: readonly DatedAppearance[]): number {
  return normalizedUpcomingRows.length;
}

/** The presentation group a row belongs to: its Event, or itself. */
export function previewGroupKey(row: Pick<DatedAppearance, "id" | "event_id">): string {
  return row.event_id ? `event:${row.event_id}` : `appearance:${row.id}`;
}

export interface AppearancePreviewGroup<A> {
  key: string;
  /** The date shown for the group: the one live right now, else the next. */
  representative: A;
  /** Every upcoming dated Appearance in this group, in input order — the
   * group stands for dates.length Appearances. */
  dates: A[];
}

function isLive(a: DatedAppearance, now: number): boolean {
  return Boolean(a.end_at) && new Date(a.start_at).getTime() <= now && new Date(a.end_at!).getTime() > now;
}

/** PRESENTATION ONLY. `rows` must already be one Business's normalized,
 * upcoming, start-ordered dated Appearances. Returns one group per Event
 * (and one per standalone Appearance), ordered by each group's earliest
 * date — so a multi-date Event takes one preview slot, never all of them. */
export function groupAppearancesForPreview<A extends DatedAppearance>(
  rows: A[],
  now: number = Date.now()
): AppearancePreviewGroup<A>[] {
  const groups = new Map<string, AppearancePreviewGroup<A>>();
  for (const r of rows) {
    const key = previewGroupKey(r);
    const g = groups.get(key);
    if (g) g.dates.push(r);
    else groups.set(key, { key, representative: r, dates: [r] });
  }
  for (const g of groups.values()) g.representative = g.dates.find((d) => isLive(d, now)) ?? g.dates[0];
  return [...groups.values()];
}

/** PRESENTATION ONLY — one card per Event (its live date, else its next
 * date) plus each standalone Appearance: the Business page's Featured
 * Appearance input. */
export function collapseEventDates<A extends DatedAppearance>(rows: A[], now: number = Date.now()): A[] {
  return groupAppearancesForPreview(rows, now).map((g) => g.representative);
}
