// Public Actions — what a visitor can DO from a Business, Location or Event
// page: up to three entity-controlled buttons in one shared action bar.
// Pure (client + server).
//
// The canonical ACTION TYPE decides behavior; a custom label changes only the
// words on the button. Every type routes to an existing Findmi system:
//   general_inquiry      → the existing public Inquire / Contact form
//   <commercial intent>  → Commercial Inquiry with that intent (via the
//                          sender's private Target and its composer)
//   event_participation  → the Event's existing participation application
//   opportunity          → one specific existing Opportunity listing
//   website              → the entity's own saved website (never a free URL)
// Nothing here is Open To (a broader commercial posture, not built yet).
import { COMMERCIAL_INTENT_LABELS, type CommercialIntent, type TargetKind } from "./commercial-intents";
import { INQUIRY_INTENTS_BY_KIND } from "./commercial-inquiries-domain";

export const PUBLIC_ACTION_TYPES = [
  "general_inquiry",
  "booking",
  "wholesale",
  "distribution",
  "collaboration",
  "sponsorship",
  "sampling",
  "activation",
  "pop_up",
  "content",
  "placement",
  "vending",
  "event_participation",
  "opportunity",
  "website",
] as const;
export type PublicActionType = (typeof PUBLIC_ACTION_TYPES)[number];

export const MAX_PUBLIC_ACTIONS = 3;
/** Fits three equal buttons at 360px on two lines (see labelFits). */
export const PUBLIC_ACTION_LABEL_MAX = 20;
const LINE_CHARS = 12;

export const PUBLIC_ACTION_DEFAULT_LABELS: Record<PublicActionType, string> = {
  general_inquiry: "Inquire",
  booking: "Book Us",
  wholesale: "Wholesale",
  distribution: "Distribution",
  collaboration: "Collaborate",
  sponsorship: "Sponsor",
  sampling: "Sampling",
  activation: "Activation",
  pop_up: "Pop-Up",
  content: "Content",
  placement: "Placement",
  vending: "Vending",
  event_participation: "Apply To Participate",
  opportunity: "View Opportunity",
  website: "Website",
};

/** What the manager picks from (the type, described plainly). */
export const PUBLIC_ACTION_TYPE_LABELS: Record<PublicActionType, string> = {
  general_inquiry: "General Inquiry",
  booking: "Booking",
  wholesale: "Wholesale",
  distribution: "Distribution",
  collaboration: "Collaboration",
  sponsorship: "Sponsorship",
  sampling: "Sampling",
  activation: "Activation",
  pop_up: "Pop-Up",
  content: "Content",
  placement: "Placement",
  vending: "Vending",
  event_participation: "Event Participation",
  opportunity: "Opportunity",
  website: "Website",
};

const COMMERCIAL_ACTIONS = new Set<PublicActionType>(["booking", "wholesale", "distribution", "collaboration", "sponsorship", "sampling", "activation", "pop_up", "content", "placement", "vending"]);

/** Which types make sense for each kind. Commercial types follow the existing
 * Inquiry intent matrix; Event Participation is Event-only. */
export const PUBLIC_ACTIONS_BY_KIND: Record<TargetKind, readonly PublicActionType[]> = {
  business: ["general_inquiry", ...commercialFor("business"), "opportunity", "website"],
  location: ["general_inquiry", ...commercialFor("location"), "opportunity", "website"],
  event: ["general_inquiry", "event_participation", ...commercialFor("event"), "opportunity", "website"],
};

function commercialFor(kind: TargetKind): PublicActionType[] {
  return PUBLIC_ACTION_TYPES.filter((t) => COMMERCIAL_ACTIONS.has(t) && (INQUIRY_INTENTS_BY_KIND[kind] as readonly string[]).includes(t));
}

export const isPublicActionType = (v: unknown): v is PublicActionType => typeof v === "string" && (PUBLIC_ACTION_TYPES as readonly string[]).includes(v);

export function isActionCompatible(kind: TargetKind, type: PublicActionType): boolean {
  return PUBLIC_ACTIONS_BY_KIND[kind].includes(type);
}

/** The Commercial Inquiry intent an action sends, or null when it routes elsewhere. */
export function actionIntent(type: PublicActionType): CommercialIntent | null {
  return COMMERCIAL_ACTIONS.has(type) ? (type as CommercialIntent) : null;
}

export type PublicActionRoute = "general_inquiry" | "commercial_inquiry" | "event_participation" | "opportunity" | "website";

/** Behavior comes from the type alone — never from the label. */
export function actionRoute(type: PublicActionType): PublicActionRoute {
  if (actionIntent(type)) return "commercial_inquiry";
  return type as Exclude<PublicActionType, CommercialIntent>;
}

/** Needs a Business acting on Findmi (Commercial Inquiry, Opportunity). */
export const actionNeedsBusiness = (type: PublicActionType) => {
  const r = actionRoute(type);
  return r === "commercial_inquiry" || r === "opportunity";
};

/** The sheet's heading, e.g. "Wholesale Inquiry". */
export function actionTitle(type: PublicActionType): string {
  const intent = actionIntent(type);
  return intent ? `${COMMERCIAL_INTENT_LABELS[intent]} Inquiry` : PUBLIC_ACTION_TYPE_LABELS[type];
}

// ── Labels ─────────────────────────────────────────────────────────────────

const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9 &'’.,!?+/-]*$/;

/** Title Case for display ("partner with us" → "Partner With Us" — Findmi's
 * button copy capitalizes every word, matching "Apply To Participate").
 * Words the manager typed in capitals (e.g. "BBQ") are kept. */
export function toTitleCase(label: string): string {
  return label
    .split(" ")
    .map((w) => (w.length && w === w.toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Greedy wrap at the three-button width: every word fits a line and the
 * whole label fits two lines. */
export function labelFits(label: string): boolean {
  const words = label.split(" ");
  if (words.some((w) => w.length > LINE_CHARS)) return false;
  let lines = 1;
  let len = 0;
  for (const w of words) {
    if (len === 0) len = w.length;
    else if (len + 1 + w.length <= LINE_CHARS) len += 1 + w.length;
    else {
      lines++;
      len = w.length;
    }
  }
  return lines <= 2;
}

export type LabelCheck = { ok: true; value: string | null } | { ok: false; error: string };

/** A custom label: trimmed, single-spaced, safe characters only, at most
 * 20 characters, and it must fit the three-button layout. Empty means "use
 * the default" (null) — never an empty button. */
export function validateActionLabel(raw: unknown): LabelCheck {
  if (raw == null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: "Enter a button label." };
  const value = raw.replace(/\s+/g, " ").trim();
  if (!value) return { ok: true, value: null };
  if (value.length > PUBLIC_ACTION_LABEL_MAX) return { ok: false, error: `Keep the label to ${PUBLIC_ACTION_LABEL_MAX} characters.` };
  if (!SAFE_LABEL.test(value)) return { ok: false, error: "Use letters, numbers and simple punctuation only." };
  if (!labelFits(value)) return { ok: false, error: "That label won't fit on the button. Try shorter words." };
  return { ok: true, value: toTitleCase(value) };
}

export const actionLabel = (a: { type: PublicActionType; label: string | null }) => a.label ?? PUBLIC_ACTION_DEFAULT_LABELS[a.type];

// ── Configuration ──────────────────────────────────────────────────────────

export interface PublicActionConfig {
  type: PublicActionType;
  /** Custom label (null = the default). Presentation only. */
  label: string | null;
  enabled: boolean;
  /** Opportunity actions only: the listing they open. */
  opportunityListingId: string | null;
  /** Findmi's moderation state (lib/profile-visibility.ts). Absent = live. */
  adminStatus?: "live" | "pending_review" | "hidden";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A manager's whole list, in display order: at most three, each type once
 * (an Opportunity per listing), compatible with this kind, labels valid. */
export function validatePublicActions(kind: TargetKind, raw: unknown): { ok: true; value: PublicActionConfig[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "Choose your actions." };
  if (raw.length > MAX_PUBLIC_ACTIONS) return { ok: false, error: `Choose up to ${MAX_PUBLIC_ACTIONS} actions.` };
  const out: PublicActionConfig[] = [];
  const seen = new Set<string>();
  for (const item of raw as Record<string, unknown>[]) {
    const type = item?.type;
    if (!isPublicActionType(type) || !isActionCompatible(kind, type)) return { ok: false, error: "That action isn't available here." };
    const listing = type === "opportunity" ? item.opportunityListingId : null;
    if (type === "opportunity" && (typeof listing !== "string" || !UUID.test(listing))) return { ok: false, error: "Choose the Opportunity this button opens." };
    const key = type === "opportunity" ? `opportunity:${listing}` : type;
    if (seen.has(key)) return { ok: false, error: `${PUBLIC_ACTION_TYPE_LABELS[type]} is already in your actions.` };
    seen.add(key);
    const label = validateActionLabel(item.label);
    if (!label.ok) return label;
    out.push({ type, label: label.value, enabled: item.enabled !== false, opportunityListingId: (listing as string | null) ?? null });
  }
  return { ok: true, value: out };
}

/** Layout for n visible actions: one full width, two or three equal columns
 * (three use a slightly smaller type size). */
export function actionBarLayout(n: number): { cols: 0 | 1 | 2 | 3; compact: boolean } {
  const cols = Math.max(0, Math.min(MAX_PUBLIC_ACTIONS, n)) as 0 | 1 | 2 | 3;
  return { cols, compact: cols === 3 };
}
