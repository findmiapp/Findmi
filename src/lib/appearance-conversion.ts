import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EventCandidate, ImportedOccurrence } from "./event-import/types";
import { NEW_EVENT_PUBLICATION } from "./event-publication";

/** Rich Event Persistence — the domain operation that upgrades ONE existing
 * standalone schedule item (an Appearance with no Event) into the canonical
 * model:
 *
 *   Event (pending Findmi review, no host, no owner)
 *   → one Event Occurrence from the item's own date/time/place/Location
 *   → the Business's approved participation (Event + that date)
 *   → the SAME Appearance row linked to both (event_id +
 *     event_occurrence_id) — its id, Business, title, description, link,
 *     image and Location are kept; nothing is deleted or recreated.
 *
 * Conservative by design:
 *   - only a confirmed/tentative standalone item (event_id IS NULL);
 *   - an item whose source link already belongs to a Findmi Event is NOT
 *     converted (that Event exists — joining it is a separate, reviewed
 *     decision), so conversion never creates a duplicate Event;
 *   - every write is targeted by id; if a step fails the operation stops and
 *     soft-trashes (never deletes) the Event it just created, leaving the
 *     original item exactly as it was.
 *
 * Recovered rich data (legacy imports): the caller may pass the Event
 * candidate re-read from the item's own source link through the Event
 * Import pipeline. It is used ONLY after validateRecoveredIdentity confirms
 * it is the same Event (same source link, compatible name, compatible
 * date/time); otherwise nothing is written. Then the Event takes the
 * source's name, description, link, organizer name and (re-hosted) image,
 * and the date its source time — while the item's confirmed Findmi
 * Location is always kept. An image that can't be recovered is reported,
 * never replaced by other media. Organizer is a name only: it never makes
 * anyone host or owner. */

export type ConvertResult =
  | {
      status: "converted";
      eventId: string;
      occurrenceId: string;
      appearanceId: string;
      /** Rich recovery: what the image step did ("none" = the source had no image). */
      image?: "stored" | "failed" | "none";
      warnings?: string[];
    }
  | { status: "skipped"; reason: "not_found" | "already_linked" | "canceled" | "source_event_exists" | "no_end"; eventId?: string }
  | { status: "refused"; reason: IdentityMismatch; detail: string }
  | { status: "error"; error: string };

export type IdentityMismatch = "no_source_link" | "source_mismatch" | "title_mismatch" | "date_mismatch";

type AppearanceRow = {
  id: string;
  business_id: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  status: string;
  event_id: string | null;
  location_id: string | null;
  venue_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  external_url: string | null;
  flyer_image_url: string | null;
  market_id: string | null;
  market_area_id: string | null;
};

// ── identity ──────────────────────────────────────────────────────────
const hostKey = (h: string) => {
  const host = h.toLowerCase().replace(/^www\./, "");
  return host === "lu.ma" ? "luma.com" : host; // the same Luma Event, either domain
};
/** Same Event page: host (www-less, lu.ma ≡ luma.com) + path; query/hash ignored. */
export function sameSourceLink(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  try {
    const x = new URL(a);
    const y = new URL(b);
    const path = (u: URL) => u.pathname.replace(/\/+$/, "").toLowerCase() || "/";
    return hostKey(x.hostname) === hostKey(y.hostname) && path(x) === path(y);
  } catch {
    return false;
  }
}
const words = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
/** Same Event name: equal, one contains the other, or most words shared. */
export function compatibleTitle(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (x.length === 0 || y.length === 0) return false;
  const xs = x.join(" ");
  const ys = y.join(" ");
  if (xs === ys) return true;
  const [short, long] = xs.length <= ys.length ? [xs, ys] : [ys, xs];
  if (short.length >= 8 && long.includes(short)) return true;
  const setX = new Set(x);
  const setY = new Set(y);
  const shared = [...setX].filter((w) => setY.has(w)).length;
  return shared / new Set([...x, ...y]).size >= 0.6;
}
const nyDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
/** The source date matching the item: same day and starting within 3 hours
 * (a date without a time: the same New York day). */
const MAX_START_DRIFT_MS = 3 * 60 * 60 * 1000;
function matchingOccurrence(appearanceStart: string, occurrences: ImportedOccurrence[]): ImportedOccurrence | null {
  const t = Date.parse(appearanceStart);
  let best: ImportedOccurrence | null = null;
  let bestDiff = Infinity;
  for (const o of occurrences) {
    if (!o.hasTime) {
      if (o.start === nyDate(appearanceStart) && bestDiff === Infinity) best = o;
      continue;
    }
    const diff = Math.abs(Date.parse(o.start) - t);
    if (diff <= MAX_START_DRIFT_MS && diff < bestDiff) {
      best = o;
      bestDiff = diff;
    }
  }
  return best;
}

/** Is `candidate` (re-read from the item's own source link) the same Event
 * as this schedule item? Refuses on a different source link, an
 * incompatible name, or no compatible date/time. */
export function validateRecoveredIdentity(
  appearance: { title: string; start_at: string; external_url: string | null; venue_name: string | null; location_id: string | null },
  candidate: EventCandidate
): { ok: true; occurrence: ImportedOccurrence; warnings: string[] } | { ok: false; reason: IdentityMismatch; detail: string } {
  if (!appearance.external_url) return { ok: false, reason: "no_source_link", detail: "The schedule item has no source link to recover from." };
  if (!sameSourceLink(appearance.external_url, candidate.sourceUrl)) {
    return { ok: false, reason: "source_mismatch", detail: `Source link ${candidate.sourceUrl || "(none)"} is not ${appearance.external_url}.` };
  }
  if (!candidate.title || !compatibleTitle(appearance.title, candidate.title)) {
    return { ok: false, reason: "title_mismatch", detail: `"${candidate.title ?? ""}" doesn't match "${appearance.title}".` };
  }
  const occurrence = matchingOccurrence(appearance.start_at, candidate.occurrences);
  if (!occurrence) return { ok: false, reason: "date_mismatch", detail: `No source date matches ${appearance.start_at}.` };
  const warnings: string[] = [];
  const sourceVenue = occurrence.venue.name;
  if (sourceVenue && appearance.venue_name && !compatibleTitle(sourceVenue, appearance.venue_name)) {
    warnings.push(appearance.location_id ? `Source says "${sourceVenue}"; the confirmed Findmi Location is kept.` : `Source says "${sourceVenue}"; the item says "${appearance.venue_name}".`);
  }
  return { ok: true, occurrence, warnings };
}

export async function convertAppearanceToEvent(
  admin: SupabaseClient,
  appearanceId: string,
  deps: {
    uniqueEventSlug: (title: string) => Promise<string | null>;
    organizerName?: string | null;
    /** Rich recovery: the candidate re-read from the item's own source link. */
    recovered?: EventCandidate | null;
    /** The one Event image path (lib/event-import/media.ts recoverEventImage). */
    storeImage?: (url: string) => Promise<string | null>;
  }
): Promise<ConvertResult> {
  const { data } = await admin
    .from("appearances")
    .select("id, business_id, title, description, start_at, end_at, status, event_id, location_id, venue_name, address, city, state, latitude, longitude, external_url, flyer_image_url, market_id, market_area_id")
    .eq("id", appearanceId)
    .maybeSingle();
  const a = data as AppearanceRow | null;
  if (!a) return { status: "skipped", reason: "not_found" };
  if (a.event_id) return { status: "skipped", reason: "already_linked", eventId: a.event_id };
  if (a.status === "canceled") return { status: "skipped", reason: "canceled" };
  if (!a.end_at || Date.parse(a.end_at) <= Date.parse(a.start_at)) return { status: "skipped", reason: "no_end" };

  // Rich recovery is used only once it's proven to be this same Event.
  const recovered = deps.recovered ?? null;
  let sourceDate: ImportedOccurrence | null = null;
  let warnings: string[] = [];
  if (recovered) {
    const identity = validateRecoveredIdentity(a, recovered);
    if (!identity.ok) return { status: "refused", reason: identity.reason, detail: identity.detail };
    sourceDate = identity.occurrence;
    warnings = identity.warnings;
  }

  // Never a second Event for the same source: the item's link and the
  // recovered link (they may differ in form, e.g. lu.ma vs luma.com).
  for (const link of [...new Set([a.external_url, recovered?.sourceUrl].filter((l): l is string => Boolean(l)))]) {
    const { data: existing } = await admin
      .from("events")
      .select("id")
      .eq("external_url", link)
      .is("trashed_at", null)
      .neq("publication_status", "rejected")
      .limit(1);
    const hit = ((existing ?? []) as { id: string }[])[0];
    if (hit) return { status: "skipped", reason: "source_event_exists", eventId: hit.id };
  }

  // Event-level: the recovered source first, then the item's own data.
  const name = recovered?.title ?? a.title;
  const slug = await deps.uniqueEventSlug(name);
  if (!slug) return { status: "error", error: "no_slug" };
  let cover: string | null = a.flyer_image_url;
  let image: "stored" | "failed" | "none" | undefined;
  if (recovered) {
    if (recovered.imageUrl && deps.storeImage) {
      const stored = await deps.storeImage(recovered.imageUrl);
      image = stored ? "stored" : "failed";
      // Only the Event's own image (or the item's own existing image) —
      // never other media in its place.
      if (stored) cover = stored;
      else warnings.push("The Event image couldn't be recovered; no image was substituted.");
    } else image = "none";
  }
  // Occurrence: the source's date/time when it has one; the confirmed
  // Findmi Location (and its venue text) is always kept.
  const startAt = sourceDate?.hasTime ? sourceDate.start : a.start_at;
  const endAt = sourceDate?.hasTime && sourceDate.end && Date.parse(sourceDate.end) > Date.parse(sourceDate.start) ? sourceDate.end : a.end_at;
  const keepPlace = Boolean(a.location_id) || !sourceDate || !(sourceDate.venue.name || sourceDate.venue.address);
  const place = keepPlace
    ? { venue_name: a.venue_name, address: a.address, city: a.city, state: a.state }
    : { venue_name: sourceDate!.venue.name, address: sourceDate!.venue.address, city: sourceDate!.venue.city ?? a.city, state: sourceDate!.venue.state ?? a.state };

  const { data: created, error } = await admin
    .from("events")
    .insert({
      name,
      slug,
      start_at: startAt,
      end_at: endAt,
      // Live by default, like every new Event (lib/event-publication.ts).
      ...NEW_EVENT_PUBLICATION,
      host_business_id: null,
      organizer_name: recovered?.organizer ?? deps.organizerName ?? null,
      description: recovered?.description ?? a.description,
      external_url: recovered?.sourceUrl || a.external_url,
      cover_image_url: cover,
      ...place,
      latitude: a.latitude,
      longitude: a.longitude,
      market_id: a.market_id,
      market_area_id: a.market_area_id,
    })
    .select("id")
    .single();
  if (error || !created) return { status: "error", error: "event_insert_failed" };
  const eventId = (created as { id: string }).id;
  const undo = async (why: string): Promise<ConvertResult> => {
    await admin.from("events").update({ trashed_at: new Date().toISOString() }).eq("id", eventId);
    return { status: "error", error: why };
  };

  const { data: occ, error: occError } = await admin
    .from("event_occurrences")
    .insert({
      event_id: eventId,
      start_at: startAt,
      end_at: endAt,
      location_id: a.location_id,
      ...place,
    })
    .select("id")
    .single();
  if (occError || !occ) return undo("occurrence_insert_failed");
  const occurrenceId = (occ as { id: string }).id;

  const { error: rosterError } = await admin
    .from("event_businesses")
    .upsert({ event_id: eventId, business_id: a.business_id, status: "approved", participation_scope: "all_dates" }, { onConflict: "event_id,business_id" });
  if (rosterError) return undo("participation_failed");
  const { error: occRosterError } = await admin
    .from("event_occurrence_businesses")
    .upsert({ occurrence_id: occurrenceId, business_id: a.business_id, status: "approved" }, { onConflict: "occurrence_id,business_id" });
  if (occRosterError) return undo("participation_failed");

  // The SAME row, now linked — id, Business, title, description, link,
  // image and Location untouched. It becomes the official participation
  // row for that date, so Event/date edits keep it in sync from now on.
  const { error: linkError } = await admin
    .from("appearances")
    .update({
      event_id: eventId,
      event_occurrence_id: occurrenceId,
      source: "official_participation",
      // Its date follows the Event's source date when that was recovered.
      ...(startAt !== a.start_at || endAt !== a.end_at ? { start_at: startAt, end_at: endAt } : {}),
    })
    .eq("id", a.id)
    .is("event_id", null);
  if (linkError) return undo("link_failed");

  return { status: "converted", eventId, occurrenceId, appearanceId: a.id, ...(recovered ? { image, warnings } : {}) };
}
