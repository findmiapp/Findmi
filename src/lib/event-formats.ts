// Event Formats V1 — HOW an Event is experienced (zero-to-many), separate
// from Event Category/Subcategory (WHAT it is about). The vocabulary is
// kind='event_format' rows in `categories` (flat); the links live in their
// own `event_formats` table — never in event_categories. Pure; safe for
// client and server.

/** The approved V1 vocabulary (seeded by the event_formats_v1 migration). */
export const EVENT_FORMAT_V1 = [
  { name: "Brand Activation", slug: "brand-activation" },
  { name: "Pop-Up", slug: "pop-up" },
  { name: "Sampling", slug: "sampling" },
  { name: "Product Launch", slug: "product-launch" },
  { name: "Retail Experience", slug: "retail-experience" },
  { name: "Sample Sale", slug: "sample-sale" },
  { name: "Market", slug: "market" },
  { name: "Festival", slug: "festival" },
  { name: "Networking", slug: "networking" },
  { name: "Talk & Panel", slug: "talk-panel" },
  { name: "Workshop", slug: "workshop" },
  { name: "Conference", slug: "conference" },
  { name: "Exhibition", slug: "exhibition" },
  { name: "Immersive Experience", slug: "immersive-experience" },
  { name: "Performance", slug: "performance" },
  { name: "Party & Social", slug: "party-social" },
] as const;

/** Every form that renders the Format picker submits this marker, so a
 * save can tell "the person edited Formats (possibly clearing them all)"
 * from "this form doesn't edit Formats" — only the former touches links. */
export const EVENT_FORMATS_PRESENT_FIELD = "format_ids_present";
export const EVENT_FORMAT_IDS_FIELD = "format_ids";

export type EventFormatWrite = { kind: "keep" } | { kind: "set"; ids: string[] };

interface FormLike {
  has(name: string): boolean;
  getAll(name: string): unknown[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valid, de-duplicated UUIDs, in first-seen order. */
export function cleanEventFormatIds(values: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    const id = typeof v === "string" ? v.trim().toLowerCase() : "";
    if (UUID.test(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** What a save should do to an Event's Formats: the picker was on the
 * form → make the links exactly the selection (none = clear them); no
 * picker → leave them alone. */
export function decideEventFormatWrite(form: FormLike): EventFormatWrite {
  if (!form.has(EVENT_FORMATS_PRESENT_FIELD)) return { kind: "keep" };
  return { kind: "set", ids: cleanEventFormatIds(form.getAll(EVENT_FORMAT_IDS_FIELD)) };
}

/** The minimal change from the current links to the wanted set. */
export function diffEventFormats(current: readonly string[], wanted: readonly string[]): { add: string[]; remove: string[] } {
  const cur = new Set(current);
  const want = new Set(wanted);
  return { add: [...want].filter((id) => !cur.has(id)), remove: [...cur].filter((id) => !want.has(id)) };
}
