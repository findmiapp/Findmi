/** Profile visibility — Admin-controlled public visibility of a Business's
 * outbound profile elements (links, contact, announcement) and of every
 * page's Profile Buttons (Findmi Consolidation pass). Pure; no I/O.
 *
 * Three states, shown to managers as-is:
 *   live            → LIVE ON PROFILE
 *   pending_review  → PENDING REVIEW (saved; Findmi reviews before it shows)
 *   hidden          → NOT SHOWN ON PROFILE (Findmi hid it; nothing deleted)
 *
 * Storage: businesses.public_field_status (jsonb; a missing key = live) and
 * entity_public_actions.admin_status. Both default to live, so anything
 * saved before this existed is unaffected. A Business member's NEW or
 * CHANGED value goes to pending_review; an unchanged value keeps its state;
 * a founder Admin's edit is live. Clearing a field removes its state. */

export type PublicVisibility = "live" | "pending_review" | "hidden";

export const PUBLIC_FIELD_KEYS = ["website_url", "instagram_url", "facebook_url", "tiktok_url", "email", "phone", "bulletin"] as const;
export type PublicFieldKey = (typeof PUBLIC_FIELD_KEYS)[number];
export type PublicFieldStatusMap = Partial<Record<PublicFieldKey, "pending_review" | "hidden">>;

export const PUBLIC_FIELD_LABELS: Record<PublicFieldKey, string> = {
  website_url: "Website",
  instagram_url: "Instagram",
  facebook_url: "Facebook",
  tiktok_url: "TikTok",
  email: "Email",
  phone: "Phone",
  bulletin: "Announcement",
};

export const VISIBILITY_LABELS: Record<PublicVisibility, string> = {
  live: "Live On Profile",
  pending_review: "Pending Review",
  hidden: "Not Shown On Profile",
};

export function isPublicVisibility(v: unknown): v is PublicVisibility {
  return v === "live" || v === "pending_review" || v === "hidden";
}

/** Sanitizes whatever is stored (unknown keys / values are dropped). */
export function readFieldStatusMap(raw: unknown): PublicFieldStatusMap {
  const out: PublicFieldStatusMap = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const key of PUBLIC_FIELD_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (v === "pending_review" || v === "hidden") out[key] = v;
  }
  return out;
}

export function fieldVisibility(map: PublicFieldStatusMap, key: PublicFieldKey): PublicVisibility {
  return map[key] ?? "live";
}

/** The announcement is one reviewable element made of several columns. */
export function bulletinFingerprint(b: { bulletin_enabled?: boolean | null; bulletin_label?: string | null; bulletin_heading?: string | null; bulletin_body?: string | null; bulletin_url?: string | null }): string | null {
  if (!b.bulletin_enabled || !b.bulletin_body?.trim()) return null;
  return JSON.stringify([b.bulletin_label ?? null, b.bulletin_heading ?? null, b.bulletin_body.trim(), b.bulletin_url ?? null]);
}

export type FieldValues = Partial<Record<PublicFieldKey, string | null>>;

/** The next stored map after a save of `next` over `prev`. Only keys present
 * in `next` are considered (a form saves only its own fields). */
export function nextFieldStatusMap(map: PublicFieldStatusMap, prev: FieldValues, next: FieldValues, submitter: "admin" | "business"): PublicFieldStatusMap {
  const out: PublicFieldStatusMap = { ...map };
  for (const key of PUBLIC_FIELD_KEYS) {
    if (!(key in next)) continue;
    const before = prev[key]?.trim() || null;
    const after = next[key]?.trim() || null;
    if (!after) {
      delete out[key];
      continue;
    }
    if (before === after) continue;
    if (submitter === "admin") delete out[key];
    else out[key] = "pending_review";
  }
  return out;
}

/** Nulls every outbound field that isn't live, for the public page. The
 * stored value itself is untouched. */
export function applyPublicFieldVisibility<T extends object>(business: T, map: PublicFieldStatusMap): T {
  const out: Record<string, unknown> = { ...(business as Record<string, unknown>) };
  for (const key of PUBLIC_FIELD_KEYS) {
    if (fieldVisibility(map, key) === "live") continue;
    if (key === "bulletin") out.bulletin_enabled = false;
    else if (key in out) out[key] = null;
  }
  return out as T;
}

export function hasPendingFields(map: PublicFieldStatusMap): boolean {
  return PUBLIC_FIELD_KEYS.some((k) => map[k] === "pending_review");
}

/** A Profile Button is the "same" across a save when its type, label and
 * Opportunity are unchanged — then it keeps its moderation state. */
export function publicActionKey(a: { type: string; label: string | null; opportunityListingId: string | null }): string {
  return `${a.type}|${a.label?.trim() ?? ""}|${a.opportunityListingId ?? ""}`;
}

export function nextActionStatus(previous: ReadonlyMap<string, PublicVisibility>, a: { type: string; label: string | null; opportunityListingId: string | null }, submitter: "admin" | "business"): PublicVisibility {
  if (submitter === "admin") return "live";
  return previous.get(publicActionKey(a)) ?? "pending_review";
}

/** A missing-column error (the visibility migration not applied yet): the
 * caller treats everything as live — exactly today's behavior. */
export function isMissingColumnError(error: { code?: string; message?: string } | null | undefined, column: string): boolean {
  if (!error) return false;
  return error.code === "42703" || error.code === "PGRST204" || new RegExp(column).test(error.message ?? "");
}
