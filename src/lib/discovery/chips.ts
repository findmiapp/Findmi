// Discovery Engine V1 — a query as removable filter chips. Natural-language
// interpretation, quick chips and the filter sheet all land in the same
// DiscoveryQuery; this renders it back so the interpretation is always
// visible and editable ("Tomorrow ×" "SoHo ×" "Free ×" "Coffee ×"
// "Samples ×"). Pure (client + server).

import { AUDIENCE_LABELS, BENEFIT_LABELS, ENTRY_LABELS } from "./attributes";
import { TIME_OF_DAY_LABELS, WHEN_LABELS, type DiscoveryQuery } from "./query";

export interface QueryChip {
  key: string;
  label: string;
  /** The query with just this chip removed. */
  without: DiscoveryQuery;
}

/** Display names for the slugs a query can carry. Missing names fall back
 * to the slug, never to a guess. */
export interface ChipNames {
  taxonomy?: Record<string, string>;
  topics?: Record<string, string>;
  areas?: Record<string, string>;
  markets?: Record<string, string>;
  brands?: Record<string, string>;
  places?: Record<string, string>;
  geo?: string | null;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

const clock = (c: string) => {
  const [h, m] = c.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hh = h % 12 || 12;
  return m ? `${hh}:${String(m).padStart(2, "0")} ${suffix}` : `${hh} ${suffix}`;
};

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

export function queryChips(q: DiscoveryQuery, names: ChipNames = {}): QueryChip[] {
  const out: QueryChip[] = [];
  const drop = (...keys: (keyof DiscoveryQuery)[]): DiscoveryQuery => {
    const next = { ...q };
    for (const k of keys) delete next[k];
    delete next.offset;
    return next;
  };
  const dropFrom = <K extends "brands" | "benefits" | "audience" | "entry" | "categories" | "formats" | "topics">(k: K, v: string): DiscoveryQuery => {
    const next = { ...q, [k]: (q[k] as string[]).filter((x) => x !== v) } as DiscoveryQuery;
    if (!(next[k] as string[]).length) delete next[k];
    delete next.offset;
    return next;
  };

  // WHEN
  if (q.date) out.push({ key: "date", label: shortDate(q.date), without: drop("date") });
  else if (q.from || q.to) out.push({ key: "range", label: `${q.from ? shortDate(q.from) : "Today"} – ${q.to ? shortDate(q.to) : "Later"}`, without: drop("from", "to") });
  else if (q.month) out.push({ key: "month", label: monthLabel(q.month), without: drop("month") });
  else if (q.year) out.push({ key: "year", label: q.year, without: drop("year") });
  if (q.when && !q.date && !q.from && !q.to && !q.month && !q.year) out.push({ key: "when", label: WHEN_LABELS[q.when], without: drop("when") });
  if (q.tfrom || q.tto) out.push({ key: "time", label: `${q.tfrom ? clock(q.tfrom) : "Any"} – ${q.tto ? clock(q.tto) : "Late"}`, without: drop("tfrom", "tto") });
  else if (q.tod) out.push({ key: "tod", label: TIME_OF_DAY_LABELS[q.tod], without: drop("tod") });

  // WHERE
  if (q.near) out.push({ key: "near", label: "Near Me", without: drop("near", "bbox", "radius") });
  if (q.place) out.push({ key: "place", label: names.places?.[q.place] ?? q.place, without: drop("place") });
  if (q.area) out.push({ key: "area", label: names.areas?.[q.area] ?? q.area, without: drop("area") });
  else if (q.market) out.push({ key: "market", label: names.markets?.[q.market] ?? q.market, without: drop("market", "area") });
  if (q.census) out.push({ key: "geo", label: names.geo ?? "Selected Area", without: drop("census") });

  // COST / WHAT
  if (q.free) out.push({ key: "free", label: "Free", without: drop("free") });
  if (q.paid) out.push({ key: "paid", label: "Paid", without: drop("paid") });
  for (const s of q.brands ?? []) out.push({ key: `brand:${s}`, label: names.brands?.[s] ?? s, without: dropFrom("brands", s) });
  for (const s of q.topics ?? []) out.push({ key: `topic:${s}`, label: names.topics?.[s] ?? s, without: dropFrom("topics", s) });
  for (const s of q.categories ?? []) out.push({ key: `cat:${s}`, label: names.taxonomy?.[s] ?? s, without: dropFrom("categories", s) });
  for (const s of q.formats ?? []) out.push({ key: `fmt:${s}`, label: names.taxonomy?.[s] ?? s, without: dropFrom("formats", s) });
  if (q.text) out.push({ key: "text", label: q.text.replace(/\b\w/g, (c) => c.toUpperCase()), without: drop("text") });
  // "Samples" reads naturally beside a "Free" chip; the value is free_samples.
  const benefitLabel = (b: keyof typeof BENEFIT_LABELS) => (b === "free_samples" ? "Samples" : BENEFIT_LABELS[b]);
  for (const b of q.benefits ?? []) out.push({ key: `benefit:${b}`, label: benefitLabel(b), without: dropFrom("benefits", b) });
  if (q.family) out.push({ key: "family", label: "Family", without: drop("family") });
  for (const a of q.audience ?? []) out.push({ key: `aud:${a}`, label: AUDIENCE_LABELS[a], without: dropFrom("audience", a) });
  for (const e of q.entry ?? []) out.push({ key: `entry:${e}`, label: ENTRY_LABELS[e], without: dropFrom("entry", e) });
  for (const a of q.access ?? []) out.push({ key: `access:${a}`, label: a === "rsvp" ? "RSVP" : "Tickets", without: { ...drop(), access: q.access!.filter((x) => x !== a) } });
  if (q.open) out.push({ key: "open", label: "Open Now", without: drop("open") });
  if (q.endingSoonHours) out.push({ key: "ending", label: "Ending Soon", without: drop("endingSoonHours") });
  if (q.justAnnouncedDays) out.push({ key: "new", label: "Just Announced", without: drop("justAnnouncedDays") });
  return out;
}

/** The WHAT labels a result is matched on — for "Matches Coffee + Free". */
export function matchLabels(q: DiscoveryQuery, names: ChipNames = {}): string[] {
  const keys = new Set(["text", "free", "paid", "family", "open"]);
  return queryChips(q, names)
    .filter((c) => keys.has(c.key) || /^(brand|topic|cat|fmt|benefit|aud|entry):/.test(c.key))
    .map((c) => c.label);
}
