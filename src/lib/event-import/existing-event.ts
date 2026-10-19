import "server-only";
// Admin Event Import — "Review Existing Event": an imported Event that is
// already on Findmi is never duplicated, and never discarded either. Its
// current record is compared with what the import found, and Admin may:
//   - FILL a field the existing Event leaves empty (image, description,
//     Event Link, RSVP / tickets, organizer, category, Formats, a Business);
//   - REPLACE a populated field only by an explicit per-field choice
//     (image, description, Event Link, RSVP / tickets, organizer).
// Nothing is applied automatically, and the server re-reads the Event
// before writing: a field filled meanwhile is never overwritten by "fill".
// Dates, places and the Event's host are not changed from here.
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateCustomDestination } from "../navigation";
import { cleanText } from "../brand-website-extract";
import { cleanEventDescription } from "./description";
import { attendanceEventColumns, normalizeReviewedAttendance, normalizeReviewedUrl } from "./attendance";
import { existingEventCategoryIds } from "../event-categories-server";
import { cleanEventFormatIds } from "../event-formats";
import { syncEventFormats } from "../event-formats-server";
import type { EventImportReview } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "attendance" is the RSVP / Registration action (events.rsvp_url);
// "tickets" the Get Tickets action (events.tickets_url) — compared and
// filled separately, so one never overwrites the other.
export type ExistingField = "image" | "description" | "link" | "attendance" | "tickets" | "organizer" | "category" | "formats" | "business";
export const EXISTING_FIELD_LABEL: Record<ExistingField, string> = {
  image: "Image",
  description: "Description",
  link: "Event Link",
  attendance: "RSVP / Registration",
  tickets: "Tickets",
  organizer: "Organizer",
  category: "Category",
  formats: "Formats",
  business: "Business",
};
/** Fields whose populated value may be replaced by explicit choice. */
const REPLACEABLE = new Set<ExistingField>(["image", "description", "link", "attendance", "tickets", "organizer"]);

export interface ExistingEventSnapshot {
  id: string;
  name: string;
  slug: string;
  coverImageUrl: string | null;
  description: string | null;
  externalUrl: string | null;
  /** The RSVP / Registration link (rsvp_url). */
  attendanceUrl: string | null;
  /** The Get Tickets link (tickets_url). */
  ticketsUrl: string | null;
  organizerName: string | null;
  categoryIds: string[];
  formatIds: string[];
  businesses: { id: string; name: string }[];
  occurrenceCount: number;
  occurrencesWithoutLocation: number;
}

export async function loadExistingEventSnapshot(admin: SupabaseClient, id: string): Promise<ExistingEventSnapshot | null> {
  if (!UUID.test(id)) return null;
  const { data } = await admin
    .from("events")
    .select("id, name, slug, cover_image_url, description, external_url, rsvp_url, tickets_url, organizer_name")
    .eq("id", id)
    .is("trashed_at", null)
    .maybeSingle();
  const ev = data as {
    id: string;
    name: string;
    slug: string;
    cover_image_url: string | null;
    description: string | null;
    external_url: string | null;
    rsvp_url: string | null;
    tickets_url: string | null;
    organizer_name: string | null;
  } | null;
  if (!ev) return null;
  const [cats, fmts, roster, occs] = await Promise.all([
    admin.from("event_categories").select("category_id").eq("event_id", id),
    admin.from("event_formats").select("category_id").eq("event_id", id),
    admin.from("event_businesses").select("business_id, status").eq("event_id", id),
    admin.from("event_occurrences").select("id, location_id").eq("event_id", id),
  ]);
  const businessIds = ((roster.data ?? []) as { business_id: string; status: string }[]).filter((r) => r.status === "approved").map((r) => r.business_id);
  const names = businessIds.length ? (((await admin.from("businesses").select("id, name").in("id", businessIds)).data ?? []) as { id: string; name: string }[]) : [];
  const occurrences = (occs.data ?? []) as { id: string; location_id: string | null }[];
  return {
    id: ev.id,
    name: ev.name,
    slug: ev.slug,
    coverImageUrl: ev.cover_image_url,
    description: ev.description,
    externalUrl: ev.external_url,
    attendanceUrl: ev.rsvp_url || null,
    ticketsUrl: ev.tickets_url || null,
    organizerName: ev.organizer_name,
    categoryIds: ((cats.data ?? []) as { category_id: string }[]).map((r) => r.category_id),
    formatIds: ((fmts.data ?? []) as { category_id: string }[]).map((r) => r.category_id),
    businesses: names,
    occurrenceCount: occurrences.length,
    occurrencesWithoutLocation: occurrences.filter((o) => !o.location_id).length,
  };
}

/** What the import proposes for an existing Event, cleaned exactly like a new Event's values. */
export interface ExistingEventProposal {
  imageUrl: string | null;
  description: string | null;
  link: string | null;
  /** RSVP / Registration action (never "tickets" — see ticketsUrl). */
  attendance: ReturnType<typeof normalizeReviewedAttendance>;
  ticketsUrl: string | null;
  organizer: string | null;
  categoryId: string | null;
  formatIds: string[];
  business: { id: string; name: string } | null;
}

export function proposalFromReview(review: Partial<EventImportReview>, business: { id: string; name: string } | null): ExistingEventProposal {
  let imageUrl: string | null = null;
  try {
    const u = review.imageUrl ? new URL(review.imageUrl) : null;
    imageUrl = u && u.protocol === "https:" ? u.toString() : null;
  } catch {
    imageUrl = null;
  }
  const linkCheck = review.sourceUrl?.trim() ? validateCustomDestination(review.sourceUrl.trim()) : null;
  return {
    imageUrl,
    description: cleanEventDescription(review.description ?? null),
    link: linkCheck?.ok ? linkCheck.value : null,
    ...splitAttendance(normalizeReviewedAttendance(review.attendance ?? null), normalizeReviewedUrl(review.ticketsUrl ?? null)),
    organizer: cleanText(review.organizer ?? null, 160),
    categoryId: review.categoryId && UUID.test(review.categoryId) ? review.categoryId : null,
    formatIds: cleanEventFormatIds(Array.isArray(review.formatIds) ? review.formatIds : []).slice(0, 32),
    business: business && UUID.test(business.id) ? business : null,
  };
}

/** Review's attendance → the two separate existing columns: RSVP /
 * Registration (attendance) and Tickets. */
export function splitAttendance(a: ReturnType<typeof normalizeReviewedAttendance>, ticketsUrl: string | null): { attendance: ReturnType<typeof normalizeReviewedAttendance>; ticketsUrl: string | null } {
  if (a?.cta === "tickets") return { attendance: null, ticketsUrl: a.url };
  return { attendance: a, ticketsUrl };
}

export type FieldComparison = { field: ExistingField; kind: "fill" | "conflict" | "same"; existing: string | null; proposed: string };

const norm = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** Pure: each field the import could add, compared with the record. */
export function compareExistingEvent(snapshot: ExistingEventSnapshot, p: ExistingEventProposal): FieldComparison[] {
  const out: FieldComparison[] = [];
  const text = (field: ExistingField, existing: string | null, proposed: string | null) => {
    if (!proposed) return;
    if (!existing?.trim()) out.push({ field, kind: "fill", existing: null, proposed });
    else out.push({ field, kind: norm(existing) === norm(proposed) ? "same" : "conflict", existing, proposed });
  };
  text("image", snapshot.coverImageUrl, p.imageUrl);
  text("description", snapshot.description, p.description);
  text("link", snapshot.externalUrl, p.link);
  text("attendance", snapshot.attendanceUrl, p.attendance?.url ?? null);
  text("tickets", snapshot.ticketsUrl, p.ticketsUrl);
  text("organizer", snapshot.organizerName, p.organizer);
  if (p.categoryId) out.push({ field: "category", kind: snapshot.categoryIds.length === 0 ? "fill" : snapshot.categoryIds.includes(p.categoryId) ? "same" : "conflict", existing: snapshot.categoryIds.length ? `${snapshot.categoryIds.length} set` : null, proposed: p.categoryId });
  if (p.formatIds.length) out.push({ field: "formats", kind: snapshot.formatIds.length === 0 ? "fill" : p.formatIds.every((f) => snapshot.formatIds.includes(f)) ? "same" : "conflict", existing: snapshot.formatIds.length ? `${snapshot.formatIds.length} set` : null, proposed: p.formatIds.join(",") });
  if (p.business) out.push({ field: "business", kind: snapshot.businesses.some((b) => b.id === p.business!.id) ? "same" : "fill", existing: snapshot.businesses.map((b) => b.name).join(", ") || null, proposed: p.business.name });
  return out;
}

export interface ExistingEventDeps {
  storeImage: (url: string) => Promise<string | null>;
  propagateDates: (eventId: string, occurrenceIds: string[]) => Promise<void>;
}

/** Applies ONLY the fields Admin chose. "fill" writes a field only while it
 * is still empty; "replace" (allowed for text/link/image fields only)
 * writes the import's value over the current one.
 *
 * participantIds: involved Businesses the operator explicitly resolved in
 * this review (Match Existing / Create — never "ignored", never an
 * unresolved candidate), already validated as real Business ids by the
 * caller. Each joins through the same participation the primary Business
 * uses (event_businesses approved, all dates → the existing date sync);
 * a Business already approved on the Event is left as it is. */
export async function applyExistingEventEnrichment(
  admin: SupabaseClient,
  eventId: string,
  choices: Partial<Record<ExistingField, "fill" | "replace">>,
  p: ExistingEventProposal,
  deps: ExistingEventDeps,
  participantIds: string[] = []
): Promise<{ ok: true; applied: ExistingField[]; participants?: string[] } | { ok: false; error: string }> {
  const snapshot = await loadExistingEventSnapshot(admin, eventId);
  if (!snapshot) return { ok: false, error: "That Event is no longer on Findmi." };
  const comparisons = new Map(compareExistingEvent(snapshot, p).map((c) => [c.field, c]));
  const allowed = (field: ExistingField) => {
    const choice = choices[field];
    const c = comparisons.get(field);
    if (!choice || !c || c.kind === "same") return false;
    if (c.kind === "fill") return true;
    return choice === "replace" && REPLACEABLE.has(field);
  };
  const applied: ExistingField[] = [];
  const patch: Record<string, unknown> = {};
  if (allowed("image") && p.imageUrl) {
    const stored = await deps.storeImage(p.imageUrl);
    if (stored) {
      patch.cover_image_url = stored;
      applied.push("image");
    }
  }
  if (allowed("description")) (patch.description = p.description), applied.push("description");
  if (allowed("link")) (patch.external_url = p.link), applied.push("link");
  // Each action only from its own proposed value; an absent proposal is
  // never a reason to clear anything.
  if (allowed("attendance") && p.attendance) Object.assign(patch, attendanceEventColumns(p.attendance)), applied.push("attendance");
  if (allowed("tickets") && p.ticketsUrl) Object.assign(patch, { tickets_enabled: true, tickets_url: p.ticketsUrl }), applied.push("tickets");
  if (allowed("organizer")) (patch.organizer_name = p.organizer), applied.push("organizer");
  if (Object.keys(patch).length > 0) {
    const { error } = await admin.from("events").update(patch).eq("id", eventId);
    if (error) return { ok: false, error: "Couldn't update the Event. Please try again." };
  }
  // Taxonomy: only onto an Event that has none (never re-categorized from here).
  if (allowed("category") && choices.category === "fill" && p.categoryId) {
    const ids = await existingEventCategoryIds(admin, [p.categoryId]);
    if (ids.length && !(await admin.from("event_categories").insert({ event_id: eventId, category_id: ids[0] })).error) applied.push("category");
  }
  if (allowed("formats") && choices.formats === "fill" && p.formatIds.length) {
    if (!(await syncEventFormats(admin, eventId, p.formatIds)).error) applied.push("formats");
  }
  // Business: the same participation Admin import gives a new Event —
  // added to the roster, never the host, never replacing anyone.
  const joinRoster = async (businessId: string) =>
    !(
      await admin
        .from("event_businesses")
        .upsert({ event_id: eventId, business_id: businessId, status: "approved", participation_scope: "all_dates" }, { onConflict: "event_id,business_id" })
    ).error;
  if (allowed("business") && p.business && (await joinRoster(p.business.id))) applied.push("business");
  const onRoster = new Set(snapshot.businesses.map((b) => b.id));
  if (p.business) onRoster.add(p.business.id);
  const participants: string[] = [];
  for (const id of [...new Set(participantIds)]) {
    if (!onRoster.has(id) && (await joinRoster(id))) participants.push(id);
  }
  if (applied.includes("business") || participants.length > 0) {
    const { data: occs } = await admin.from("event_occurrences").select("id").eq("event_id", eventId);
    const ids = ((occs ?? []) as { id: string }[]).map((o) => o.id);
    if (ids.length) await deps.propagateDates(eventId, ids);
  }
  return participants.length > 0 ? { ok: true, applied, participants } : { ok: true, applied };
}
