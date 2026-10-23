// Business Home → Follow-Ups: this Business's own Target follow-ups — the next
// step (and its date) on its business_location_placements rows, which are
// private to it. Not a task system: nothing is stored, nothing is checked off;
// a follow-up disappears when its Target's next step changes. Pure and
// client-safe — the page passes in rows it has already read.
import { PLACEMENT_STATUS_LABELS, type PlacementStatus } from "./business-placements-domain";

/** Home shows this many; See All shows the rest of the (bounded) list. */
export const FOLLOW_UPS_INITIAL_LIMIT = 3;
/** How many Targets with a next step Home reads at most. */
export const FOLLOW_UPS_READ_LIMIT = 25;
/** A dated step this many days out (or fewer) is "due soon". */
export const FOLLOW_UP_SOON_DAYS = 7;

export interface FollowUpPlacement {
  locationId: string;
  locationName: string;
  status: PlacementStatus;
  nextAction: string | null;
  /** Date-only (YYYY-MM-DD), judged against the app calendar day. */
  nextActionAt: string | null;
}

export type FollowUpDue = "overdue" | "today" | "soon" | "later";

export interface FollowUp {
  key: string;
  /** The place. */
  title: string;
  /** Status · when ("In Conversation · Follow Up Tomorrow"). */
  meta: string;
  /** The step itself, when there is one. */
  detail: string | null;
  due: FollowUpDue | null;
  /** The relationship workspace, addressed by the place. */
  href: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const dayNumber = (isoDate: string) => Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`) / DAY_MS;

export function followUpDue(date: string, today: string): FollowUpDue {
  const diff = dayNumber(date) - dayNumber(today);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  return diff <= FOLLOW_UP_SOON_DAYS ? "soon" : "later";
}

/** "Overdue" · "Today" · "Tomorrow" · "Oct 27" (the date itself, never shifted by a time zone). */
export function followUpDateLabel(date: string, today: string): string {
  const diff = dayNumber(date) - dayNumber(today);
  if (diff < 0) return "Overdue";
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** overdue → today → due soon → undated step → later. */
const RANK: Record<FollowUpDue | "undated", number> = { overdue: 1, today: 2, soon: 3, undated: 4, later: 5 };

export function buildFollowUps({
  basePath,
  placements,
  today,
}: {
  basePath: string;
  placements: readonly FollowUpPlacement[];
  /** The app calendar day (followUpToday) — same rule as Targets. */
  today: string;
}): FollowUp[] {
  const items: { item: FollowUp; rank: number; date: string }[] = [];
  for (const p of placements) {
    if (p.status === "passed") continue;
    const step = p.nextAction?.trim() || null;
    if (!step && !p.nextActionAt) continue;
    const due = p.nextActionAt ? followUpDue(p.nextActionAt, today) : null;
    const when = p.nextActionAt
      ? due === "overdue"
        ? "Overdue"
        : due === "today"
          ? "Due Today"
          : `Follow Up ${followUpDateLabel(p.nextActionAt, today)}`
      : null;
    items.push({
      item: {
        key: `placement:${p.locationId}`,
        title: p.locationName,
        meta: [PLACEMENT_STATUS_LABELS[p.status], when].filter(Boolean).join(" · "),
        detail: step,
        due,
        href: `${basePath}?tab=growth&view=targets&loc=${p.locationId}`,
      },
      rank: RANK[due ?? "undated"],
      date: p.nextActionAt?.slice(0, 10) ?? "9999",
    });
  }
  // Deterministic: rank, then soonest date, then place name, then key.
  items.sort((a, b) => a.rank - b.rank || a.date.localeCompare(b.date) || a.item.title.localeCompare(b.item.title) || a.item.key.localeCompare(b.item.key));
  return items.map((i) => i.item);
}
