// Discovery Engine V1 — the structured, explicitly-set Event attributes the
// Discovery Query filters on. Never inferred from descriptions: an Event
// has a benefit only when someone set it. "Free Admission" and "Free Food"
// are different values. Pure (client + server). Mirrors the CHECKs in
// supabase/migrations/20261114000000_discovery_engine_map_v1.sql.

export const EVENT_BENEFITS = ["free_admission", "free_food", "free_drinks", "free_samples", "free_products", "giveaways", "swag", "discounts", "prizes"] as const;
export type EventBenefit = (typeof EVENT_BENEFITS)[number];

export const BENEFIT_LABELS: Record<EventBenefit, string> = {
  free_admission: "Free Admission",
  free_food: "Free Food",
  free_drinks: "Free Drinks",
  free_samples: "Free Samples",
  free_products: "Free Products",
  giveaways: "Giveaways",
  swag: "Swag",
  discounts: "Discounts",
  prizes: "Prizes",
};

/** Audience values that are only ever set explicitly. 21+ is a legal
 * restriction — it is never derived from a category or from prose. */
export const EVENT_AUDIENCES = ["all_ages", "family", "kids", "adults", "21_plus", "professional"] as const;
export type EventAudience = (typeof EVENT_AUDIENCES)[number];

export const AUDIENCE_LABELS: Record<EventAudience, string> = {
  all_ages: "All Ages",
  family: "Family",
  kids: "Kids",
  adults: "Adults",
  "21_plus": "21+",
  professional: "Professional",
};

export const ENTRY_MODES = ["walk_in", "rsvp", "ticket", "reservation", "invite"] as const;
export type EntryMode = (typeof ENTRY_MODES)[number];

export const ENTRY_LABELS: Record<EntryMode, string> = {
  walk_in: "Walk-In",
  rsvp: "RSVP",
  ticket: "Tickets",
  reservation: "Reservation",
  invite: "Invite Only",
};

const pick = <T extends string>(allowed: readonly T[], raw: unknown): T[] =>
  Array.isArray(raw) ? [...new Set(raw.filter((v): v is T => typeof v === "string" && (allowed as readonly string[]).includes(v)))] : [];

export const normalizeBenefits = (raw: unknown) => pick(EVENT_BENEFITS, raw);
export const normalizeAudience = (raw: unknown) => pick(EVENT_AUDIENCES, raw);
export const normalizeEntryModes = (raw: unknown) => pick(ENTRY_MODES, raw);

/** Admin form → stored arrays (checkbox groups named benefits / audience /
 * entry_modes). Unknown values are dropped, never stored. */
export function eventAttributesFromForm(formData: FormData): { benefits: EventBenefit[]; audience: EventAudience[]; entry_modes: EntryMode[]; min_age: number | null; max_age: number | null } {
  const age = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    if (!/^\d{1,2}$/.test(v)) return null;
    return Number(v);
  };
  let min_age = age("min_age");
  let max_age = age("max_age");
  if (min_age !== null && max_age !== null && min_age > max_age) [min_age, max_age] = [max_age, min_age];
  return {
    benefits: normalizeBenefits(formData.getAll("benefits")),
    audience: normalizeAudience(formData.getAll("audience")),
    entry_modes: normalizeEntryModes(formData.getAll("entry_modes")),
    min_age,
    max_age,
  };
}
