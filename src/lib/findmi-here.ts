/** Business Findmi Here — presentation-layer collapse of Event dates.
 *
 * A Business can carry one Appearance per date of a multi-date Event (e.g.
 * 12 dates of one pop-up). The public Business page shows ONE card per
 * Event — the date that is live right now, else the next upcoming one —
 * while standalone appearances stay individual (never merged, even when
 * two share a title). event_id is authoritative; nothing here writes. */

export interface CollapsibleAppearance {
  id: string;
  event_id: string | null;
  start_at: string;
  end_at: string | null;
}

function isLive(a: CollapsibleAppearance, now: number): boolean {
  return Boolean(a.end_at) && new Date(a.start_at).getTime() <= now && new Date(a.end_at!).getTime() > now;
}

/** `rows` must already be upcoming (end > now) and sorted by start_at.
 * Returns the same order, keeping each Event's representative date at the
 * position of that Event's earliest row. */
export function collapseEventDates<A extends CollapsibleAppearance>(rows: A[], now: number = Date.now()): A[] {
  const byEvent = new Map<string, A[]>();
  for (const r of rows) {
    if (!r.event_id) continue;
    const list = byEvent.get(r.event_id);
    if (list) list.push(r);
    else byEvent.set(r.event_id, [r]);
  }
  const seen = new Set<string>();
  const out: A[] = [];
  for (const r of rows) {
    if (!r.event_id) {
      out.push(r);
      continue;
    }
    if (seen.has(r.event_id)) continue;
    seen.add(r.event_id);
    const dates = byEvent.get(r.event_id)!;
    out.push(dates.find((d) => isLive(d, now)) ?? dates[0]);
  }
  return out;
}
