// Business Home → Coming Up: the already-loaded, truthful schedule (Appearances
// and hosted Events, one row each — lib/business-dashboard buildHomeComingUp)
// grouped by when it happens, in the app's timezone. No new records, no new
// calendar: only the existing rows, bucketed by their own start date. Pure.

const APP_TIMEZONE = "America/New_York";

export type ComingUpBucket = "today" | "tomorrow" | "this-week" | "later";

export const COMING_UP_BUCKET_LABELS: Record<ComingUpBucket, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  "this-week": "This Week",
  later: "Later",
};

/** YYYY-MM-DD of an instant in the app timezone. */
function dayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000);
}

export function comingUpBucket(startAt: string, now: Date = new Date()): ComingUpBucket {
  const t = new Date(startAt);
  if (Number.isNaN(t.getTime())) return "later";
  const diff = daysBetween(dayKey(now), dayKey(t));
  if (diff <= 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff < 7) return "this-week";
  return "later";
}

/** Items grouped in chronological bucket order; empty buckets are omitted and
 * the items keep their incoming (chronological) order. */
export function groupComingUp<T extends { startAt: string }>(items: readonly T[], now: Date = new Date()): { bucket: ComingUpBucket; label: string; items: T[] }[] {
  const order: ComingUpBucket[] = ["today", "tomorrow", "this-week", "later"];
  const by = new Map<ComingUpBucket, T[]>();
  for (const item of items) {
    const b = comingUpBucket(item.startAt, now);
    by.set(b, [...(by.get(b) ?? []), item]);
  }
  return order.filter((b) => by.has(b)).map((b) => ({ bucket: b, label: COMING_UP_BUCKET_LABELS[b], items: by.get(b)! }));
}
