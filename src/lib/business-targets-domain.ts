/** Targets — the pure rules (no I/O) shared by the server reads/writes
 * (lib/business-targets.ts), the owner actions and the Targets views.
 *
 * A Target is a Business's PRIVATE commercial pursuit of exactly one
 * counterparty — a Business, a Location or an Event — for one or more
 * canonical intents (lib/commercial-intents.ts). It is intent and process —
 * never a public fact, and never seen by the counterparty. It is NOT Follow,
 * Save, Find Us Here, an Opportunity, a Conversation or an Inquiry, and
 * changing it never creates any of those. One Target per Business +
 * counterparty; a Passed Target is reopened on the same row, never duplicated. */

import type { TargetKind } from "./commercial-intents";

export const TARGET_STATUSES = ["target", "in_conversation", "agreed", "active", "passed"] as const;
export type TargetStatus = (typeof TARGET_STATUSES)[number];

export const TARGET_STATUS_LABELS: Record<TargetStatus, string> = {
  target: "Target",
  in_conversation: "In Conversation",
  agreed: "Agreed",
  active: "Active",
  passed: "Passed",
};

export const TARGET_STATUS_HINTS: Record<TargetStatus, string> = {
  target: "Someone you want to work with.",
  in_conversation: "You’re talking with them.",
  agreed: "Agreed — waiting to go live.",
  active: "It’s happening. This doesn’t change Find Us Here on its own.",
  passed: "Not pursuing this now. Reopen it any time.",
};

export const TARGET_STATUS_TONE: Record<TargetStatus, "aqua" | "aquaSoft" | "amber" | "neutral"> = {
  target: "neutral",
  in_conversation: "aquaSoft",
  agreed: "amber",
  active: "aqua",
  passed: "neutral",
};

export const TARGET_SOURCES = ["business", "admin"] as const;
export type TargetSource = (typeof TARGET_SOURCES)[number];

export const TARGET_LIMITS = { context: 2000, internalNotes: 2000, nextAction: 500 } as const;
export const TARGET_PAGE_SIZE = 25;

/** Search needs this many characters before any counterparty is listed — never a dump. */
export const TARGET_SEARCH_MIN_CHARS = 2;

/** Counterparty kind as people say it ("Place", not "Location"). */
export const TARGET_KIND_LABELS: Record<TargetKind, string> = { location: "Place", business: "Business", event: "Event" };

/** Growth → Targets lens chips (URL `tk`). */
export const TARGET_KIND_FILTERS = ["places", "businesses", "events"] as const;
export type TargetKindFilter = (typeof TARGET_KIND_FILTERS)[number];
export const KIND_FOR_FILTER: Record<TargetKindFilter, TargetKind> = { places: "location", businesses: "business", events: "event" };
export const TARGET_KIND_FILTER_LABELS: Record<TargetKindFilter, string> = { places: "Places", businesses: "Businesses", events: "Events" };

/** The one line shown wherever Targets appear. */
export const TARGET_PRIVACY_NOTE = "Private to your team and Findmi. Targets never appear on your public profile, and whoever you target never sees it.";

const isOneOf =
  <T extends string>(values: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === "string" && (values as readonly string[]).includes(v);

export const isTargetStatus = isOneOf(TARGET_STATUSES);
export const isTargetKindFilter = isOneOf(TARGET_KIND_FILTERS);

/** Owner and manager edit; staff read. A founder admin session (Manage-As)
 * manages. Mirrors the Find Us Here and Goals rules. */
export function canEditTargets(role: string | null | undefined, viaAdmin?: boolean): boolean {
  return Boolean(viaAdmin) || role === "owner" || role === "manager";
}

// ---------------------------------------------------------------- filters

export interface TargetFilter {
  q: string;
  status: TargetStatus | "";
  /** "" = all kinds. The Find Us Here lens always reads Places only. */
  kind: TargetKindFilter | "";
}

export const EMPTY_TARGET_FILTER: TargetFilter = { q: "", status: "", kind: "" };

/** Search text safe for a PostgREST or() list (same rule as the Find Us Here filter). */
export const cleanTargetQuery = (v: unknown): string => (typeof v === "string" ? v.replace(/[%,()*\\"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) : "");

/** From untrusted URL params (tq / ts / tk). */
export function parseTargetFilter(raw: { q?: unknown; status?: unknown; kind?: unknown }): TargetFilter {
  return { q: cleanTargetQuery(raw.q), status: isTargetStatus(raw.status) ? raw.status : "", kind: isTargetKindFilter(raw.kind) ? raw.kind : "" };
}

export function isEmptyTargetFilter(f: TargetFilter): boolean {
  return !f.q && !f.status;
}

// ---------------------------------------------------------------- edits

export interface TargetUpdateInput {
  status?: unknown;
  context?: unknown;
  nextAction?: unknown;
  nextActionAt?: unknown;
}

/** The exact columns a Business edit may write. internal_notes, source,
 * intents and the owner / counterparty ids are deliberately absent: this edit
 * can never reach them. */
export interface TargetUpdate {
  status: TargetStatus;
  context: string | null;
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

export function validateTargetUpdate(input: TargetUpdateInput): { ok: true; value: TargetUpdate } | { ok: false; error: string } {
  if (!isTargetStatus(input.status)) return { ok: false, error: "Choose a status." };
  const context = text(input.context);
  if (context && context.length > TARGET_LIMITS.context) return { ok: false, error: `Context can be up to ${TARGET_LIMITS.context.toLocaleString()} characters.` };
  const nextAction = text(input.nextAction)?.replace(/\s+/g, " ") ?? null;
  if (nextAction && nextAction.length > TARGET_LIMITS.nextAction) return { ok: false, error: `Next Action can be up to ${TARGET_LIMITS.nextAction} characters.` };
  const nextActionAt = parseDateOnly(input.nextActionAt);
  if (nextActionAt === "invalid") return { ok: false, error: "Choose a valid date." };
  return { ok: true, value: { status: input.status, context, next_action: nextAction, next_action_at: nextActionAt } };
}

export function validateInternalNotes(v: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  const t = text(v);
  if (t && t.length > TARGET_LIMITS.internalNotes) return { ok: false, error: `Internal notes can be up to ${TARGET_LIMITS.internalNotes.toLocaleString()} characters.` };
  return { ok: true, value: t };
}

/** Any status may move to any other — a small pipeline people correct by hand.
 * Reopening a Passed Target is simply passed → target on the same row. */
export function canChangeTargetStatus(from: TargetStatus, to: TargetStatus): boolean {
  return isTargetStatus(from) && isTargetStatus(to);
}

/** The columns an edit actually changes (empty = a no-op save). */
export function targetChanges(
  current: { status: TargetStatus; context: string | null; next_action: string | null; next_action_at: string | null },
  next: TargetUpdate
): Partial<TargetUpdate> {
  const out: Partial<TargetUpdate> = {};
  for (const k of ["status", "context", "next_action", "next_action_at"] as const) {
    if ((current[k] ?? null) !== (next[k] ?? null)) (out as Record<string, unknown>)[k] = next[k];
  }
  return out;
}

export function formatTargetDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// ---------------------------------------------------------------- activity

/** A Target's Activity: an append-only history — notes the team adds, and an
 * automatic entry whenever the status actually changes (written by the database
 * trigger, so every write path records it). Separate from Context (the mutable
 * `context` column) and from Findmi's internal notes. */
export const TARGET_ACTIVITY_TYPES = ["note", "status_change"] as const;
export type TargetActivityType = (typeof TARGET_ACTIVITY_TYPES)[number];

export const TARGET_ACTORS = ["business", "findmi"] as const;
export type TargetActor = (typeof TARGET_ACTORS)[number];

export const TARGET_ACTIVITY_NOTE_MAX = 2000;
export const TARGET_ACTIVITY_PAGE_SIZE = 25;

export const TARGET_CONTEXT_LABEL = "Context";
export const TARGET_CONTEXT_HINT = "Lasting context — who’s who, how you were introduced. Edit it any time; dated updates go in Activity.";

export function validateActivityNote(v: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const t = text(v);
  if (!t) return { ok: false, error: "Write a note first." };
  if (t.length > TARGET_ACTIVITY_NOTE_MAX) return { ok: false, error: `Notes can be up to ${TARGET_ACTIVITY_NOTE_MAX.toLocaleString()} characters.` };
  return { ok: true, value: t };
}

/** Who is acting: a founder Admin session (Manage-As) is "Findmi"; anyone else
 * acting through Business membership is a member of the Business. */
export function targetActor(viaAdmin: boolean | undefined, userId: string | null): { actor: TargetActor; userId: string | null } {
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

// ── Add Target search scope ────────────────────────────────────────────────
// "I already know who I want": one search box, optionally narrowed to a kind.
// All is the default so nobody has to know how Findmi classifies something.

export const ADD_TARGET_SCOPES = ["all", "location", "business", "event"] as const;
export type AddTargetScope = (typeof ADD_TARGET_SCOPES)[number];
export const ADD_TARGET_SCOPE_LABELS: Record<AddTargetScope, string> = { all: "All", location: "Places", business: "Businesses", event: "Events" };
export const isAddTargetScope = isOneOf(ADD_TARGET_SCOPES);
/** Per-kind bound when searching All (three bounded reads), and for one kind. */
export const ADD_TARGET_PER_KIND_ALL = 6;
export const ADD_TARGET_PER_KIND_ONE = 20;
