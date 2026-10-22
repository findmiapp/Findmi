// Business Home → Next: what THIS Business has to act on, derived from the
// records that own it — a Target's own next step (business_location_placements)
// and commercial Opportunities sent to it (opportunity_recipients /
// opportunity_listings). Not a task system: nothing is stored, nothing is
// checked off; an item disappears when its record changes. Pure and
// client-safe — the page passes in rows it has already read.
import { PLACEMENT_STATUS_LABELS, type PlacementStatus } from "./business-placements-domain";
import type { BusinessOpportunityGroup } from "./opportunity-listings-domain";

/** Home shows this many; See All shows the rest of the (bounded) list. */
export const NEXT_INITIAL_LIMIT = 3;
/** How many Targets with a next step Home reads at most. */
export const NEXT_PLACEMENT_READ_LIMIT = 25;
/** A dated step this many days out (or fewer) is "due soon". */
export const NEXT_SOON_DAYS = 7;

export interface NextPlacementInput {
  locationId: string;
  locationName: string;
  status: PlacementStatus;
  nextAction: string | null;
  /** Date-only (YYYY-MM-DD), judged against the app calendar day. */
  nextActionAt: string | null;
}

export interface NextOpportunityInput {
  recipientId: string;
  title: string;
  group: BusinessOpportunityGroup;
  responseDeadline: string | null;
}

export type NextDue = "overdue" | "today" | "soon" | "later";

export interface NextItem {
  key: string;
  /** 1 overdue · 2 today · 3 soon · 4 Opportunity needing a response ·
   * 5 undated next step · 6 later dated. */
  rank: 1 | 2 | 3 | 4 | 5 | 6;
  title: string;
  /** Status · when ("In Conversation · Follow Up Tomorrow"). */
  meta: string;
  /** The step itself, when there is one. */
  detail: string | null;
  due: NextDue | null;
  href: string;
  actionLabel: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const dayNumber = (isoDate: string) => Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`) / DAY_MS;

export function nextDue(date: string, today: string): NextDue {
  const diff = dayNumber(date) - dayNumber(today);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  return diff <= NEXT_SOON_DAYS ? "soon" : "later";
}

/** "Overdue" · "Today" · "Tomorrow" · "Oct 27" (the date itself, never shifted by a time zone). */
export function nextDateLabel(date: string, today: string): string {
  const diff = dayNumber(date) - dayNumber(today);
  if (diff < 0) return "Overdue";
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

const RANK_BY_DUE: Record<NextDue, NextItem["rank"]> = { overdue: 1, today: 2, soon: 3, later: 6 };

export function buildBusinessNext({
  basePath,
  placements,
  opportunities,
  today,
}: {
  basePath: string;
  placements: readonly NextPlacementInput[];
  opportunities: readonly NextOpportunityInput[];
  /** The app calendar day (followUpToday) — same rule as Targets. */
  today: string;
}): NextItem[] {
  const items: NextItem[] = [];
  const sortDate = new Map<string, string>();
  const add = (item: NextItem, date: string | null) => {
    items.push(item);
    sortDate.set(item.key, date?.slice(0, 10) ?? "");
  };

  for (const p of placements) {
    if (p.status === "passed") continue;
    const step = p.nextAction?.trim() || null;
    if (!step && !p.nextActionAt) continue;
    const due = p.nextActionAt ? nextDue(p.nextActionAt, today) : null;
    const when = p.nextActionAt
      ? due === "overdue"
        ? "Overdue"
        : due === "today"
          ? "Due Today"
          : `Follow Up ${nextDateLabel(p.nextActionAt, today)}`
      : null;
    add({
      key: `placement:${p.locationId}`,
      rank: due ? RANK_BY_DUE[due] : 5,
      title: p.locationName,
      meta: [PLACEMENT_STATUS_LABELS[p.status], when].filter(Boolean).join(" · "),
      detail: step,
      due,
      // The relationship workspace, addressed by the place (Block B).
      href: `${basePath}?tab=growth&view=targets&loc=${p.locationId}`,
      actionLabel: "Open Relationship",
    }, p.nextActionAt);
  }

  // Only "For You" (sent, still answerable) waits on this Business.
  for (const o of opportunities) {
    if (o.group !== "for_you") continue;
    add({
      key: `opportunity:${o.recipientId}`,
      rank: 4,
      title: o.title,
      meta: o.responseDeadline ? `Opportunity · Respond By ${nextDateLabel(o.responseDeadline, today)}` : "Opportunity · Waiting On Your Response",
      detail: null,
      due: null,
      href: `${basePath}/opportunities/${o.recipientId}`,
      actionLabel: "Respond",
    }, o.responseDeadline);
  }
  // Answered ones (Interested, Confirmed, …) leave nothing for the Business
  // to do — they stay in Growth, never as a passive summary here.

  // Deterministic: rank, then soonest date (undated last), then title, then key.
  const dateOf = (item: NextItem) => sortDate.get(item.key) || "9999";
  return items.sort((a, b) => a.rank - b.rank || dateOf(a).localeCompare(dateOf(b)) || a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
}
