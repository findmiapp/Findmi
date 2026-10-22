/** Placement Targets — the pure rules (no I/O) shared by the server reads/writes
 * (lib/business-placements.ts), the owner actions and the Targets view.
 *
 * A Placement is a Business's PRIVATE pursuit of a commercial relationship with
 * one canonical Location ("we want to get into URBY Jersey City"). It is intent
 * and process — never a public fact. It is NOT Find Us Here
 * (business_location_availability: the moderated, public statement that the
 * Business IS available there) and changing a Placement's status never creates,
 * edits or removes a Find Us Here entry. One Placement per Business + Location;
 * a Passed target is reopened on the same row, never duplicated. */

export const PLACEMENT_STATUSES = ["target", "in_conversation", "placement_pending", "active", "passed"] as const;
export type PlacementStatus = (typeof PLACEMENT_STATUSES)[number];

export const PLACEMENT_STATUS_LABELS: Record<PlacementStatus, string> = {
  target: "Target",
  in_conversation: "In Conversation",
  placement_pending: "Placement Pending",
  active: "Active",
  passed: "Passed",
};

export const PLACEMENT_STATUS_HINTS: Record<PlacementStatus, string> = {
  target: "A place you want to be in.",
  in_conversation: "You’re talking with the place.",
  placement_pending: "Agreed — waiting to go live.",
  active: "You’re in. This doesn’t change Find Us Here on its own.",
  passed: "Not pursuing this now. Reopen it any time.",
};

export const PLACEMENT_STATUS_TONE: Record<PlacementStatus, "aqua" | "aquaSoft" | "amber" | "neutral"> = {
  target: "neutral",
  in_conversation: "aquaSoft",
  placement_pending: "amber",
  active: "aqua",
  passed: "neutral",
};

export const PLACEMENT_SOURCES = ["business", "admin"] as const;
export type PlacementSource = (typeof PLACEMENT_SOURCES)[number];

export const PLACEMENT_LIMITS = { notes: 2000, internalNotes: 2000, nextAction: 500 } as const;
export const PLACEMENT_PAGE_SIZE = 25;

/** The one line shown wherever Targets appear. */
export const PLACEMENT_PRIVACY_NOTE = "Private to your team and Findmi. Targets never appear on your public profile or Find Us Here.";

const isOneOf =
  <T extends string>(values: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === "string" && (values as readonly string[]).includes(v);

export const isPlacementStatus = isOneOf(PLACEMENT_STATUSES);

/** Owner and manager edit; staff read. A founder admin session (Manage-As)
 * manages. Mirrors the Find Us Here and Goals rules. */
export function canEditPlacements(role: string | null | undefined, viaAdmin?: boolean): boolean {
  return Boolean(viaAdmin) || role === "owner" || role === "manager";
}

// ---------------------------------------------------------------- filters

export interface PlacementFilter {
  q: string;
  status: PlacementStatus | "";
}

export const EMPTY_PLACEMENT_FILTER: PlacementFilter = { q: "", status: "" };

/** From untrusted URL params (tq / ts). The search text never carries the
 * characters that break the or() list (same rule as the Find Us Here filter). */
export function parsePlacementFilter(raw: { q?: unknown; status?: unknown }): PlacementFilter {
  const q = typeof raw.q === "string" ? raw.q.replace(/[%,()*\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) : "";
  return { q, status: isPlacementStatus(raw.status) ? raw.status : "" };
}

export function isEmptyPlacementFilter(f: PlacementFilter): boolean {
  return !f.q && !f.status;
}

// ---------------------------------------------------------------- edits

export interface PlacementUpdateInput {
  status?: unknown;
  notes?: unknown;
  nextAction?: unknown;
  nextActionAt?: unknown;
}

/** The exact columns a Business edit may write. internal_notes, source,
 * business_id and location_id are deliberately absent: a Business edit can
 * never reach them. */
export interface PlacementUpdate {
  status: PlacementStatus;
  notes: string | null;
  next_action: string | null;
  next_action_at: string | null;
}

const text = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\r\n/g, "\n").trim();
  return t ? t : null;
};

/** A real calendar date as YYYY-MM-DD, or null. */
export function parseDateOnly(v: unknown): string | null | "invalid" {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return "invalid";
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? "invalid" : v;
}

export function validatePlacementUpdate(input: PlacementUpdateInput): { ok: true; value: PlacementUpdate } | { ok: false; error: string } {
  if (!isPlacementStatus(input.status)) return { ok: false, error: "Choose a status." };
  const notes = text(input.notes);
  if (notes && notes.length > PLACEMENT_LIMITS.notes) return { ok: false, error: `Notes can be up to ${PLACEMENT_LIMITS.notes.toLocaleString()} characters.` };
  const nextAction = text(input.nextAction)?.replace(/\s+/g, " ") ?? null;
  if (nextAction && nextAction.length > PLACEMENT_LIMITS.nextAction) return { ok: false, error: `Next Action can be up to ${PLACEMENT_LIMITS.nextAction} characters.` };
  const nextActionAt = parseDateOnly(input.nextActionAt);
  if (nextActionAt === "invalid") return { ok: false, error: "Choose a valid date." };
  return { ok: true, value: { status: input.status, notes, next_action: nextAction, next_action_at: nextActionAt } };
}

export function validateInternalNotes(v: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  const t = text(v);
  if (t && t.length > PLACEMENT_LIMITS.internalNotes) return { ok: false, error: `Internal notes can be up to ${PLACEMENT_LIMITS.internalNotes.toLocaleString()} characters.` };
  return { ok: true, value: t };
}

/** Any status may move to any other — a small pipeline people correct by hand.
 * Reopening a Passed target is simply passed → target on the same row. */
export function canChangePlacementStatus(from: PlacementStatus, to: PlacementStatus): boolean {
  return isPlacementStatus(from) && isPlacementStatus(to);
}

/** The columns an edit actually changes (empty = a no-op save). */
export function placementChanges(
  current: { status: PlacementStatus; notes: string | null; next_action: string | null; next_action_at: string | null },
  next: PlacementUpdate
): Partial<PlacementUpdate> {
  const out: Partial<PlacementUpdate> = {};
  for (const k of ["status", "notes", "next_action", "next_action_at"] as const) {
    if ((current[k] ?? null) !== (next[k] ?? null)) (out as Record<string, unknown>)[k] = next[k];
  }
  return out;
}

export function formatPlacementDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// ---------------------------------------------------------------- activity

/** A Placement's Activity: an append-only history — notes the team adds, and an
 * automatic entry whenever the status actually changes (written by the database
 * trigger, so every write path records it). Separate from Summary / Context
 * (the mutable `notes` column) and from Findmi's internal notes. */
export const PLACEMENT_ACTIVITY_TYPES = ["note", "status_change"] as const;
export type PlacementActivityType = (typeof PLACEMENT_ACTIVITY_TYPES)[number];

export const PLACEMENT_ACTORS = ["business", "findmi"] as const;
export type PlacementActor = (typeof PLACEMENT_ACTORS)[number];

export const PLACEMENT_ACTIVITY_NOTE_MAX = 2000;
export const PLACEMENT_ACTIVITY_PAGE_SIZE = 25;

export const PLACEMENT_SUMMARY_LABEL = "Context";
export const PLACEMENT_SUMMARY_HINT = "Lasting context about this place — who’s who, how you were introduced. Edit it any time; dated updates go in Activity.";

export function validateActivityNote(v: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const t = text(v);
  if (!t) return { ok: false, error: "Write a note first." };
  if (t.length > PLACEMENT_ACTIVITY_NOTE_MAX) return { ok: false, error: `Notes can be up to ${PLACEMENT_ACTIVITY_NOTE_MAX.toLocaleString()} characters.` };
  return { ok: true, value: t };
}

/** Who is acting: a founder Admin session (Manage-As) is "Findmi"; anyone else
 * acting through Business membership is a member of the Business. */
export function placementActor(viaAdmin: boolean | undefined, userId: string | null): { actor: PlacementActor; userId: string | null } {
  return viaAdmin ? { actor: "findmi", userId: null } : { actor: "business", userId };
}

/** The keyset cursor for "Load More": "<created_at>|<id>" of the last item
 * shown. created_at is kept exactly as the database returned it (microseconds —
 * a JS Date would drop them), and id breaks ties, so rows that share a
 * timestamp are never skipped or repeated. */
export interface ActivityCursor {
  at: string;
  id: string;
}

export function activityCursor(item: { createdAt: string; id: string }): string {
  return `${item.createdAt}|${item.id}`;
}

export function parseActivityCursor(v: unknown): ActivityCursor | null {
  if (typeof v !== "string" || v.length > 80) return null;
  const [at, id, extra] = v.split("|");
  if (extra !== undefined || !at || !id) return null;
  if (!/^\d{4}-\d{2}-\d{2}[T ][\d:.]+(Z|[+-]\d{2}(:?\d{2})?)?$/.test(at) || Number.isNaN(Date.parse(at))) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  return { at, id };
}
