import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

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
 * No UI calls this yet; it exists so a later "Convert To Event" action (or a
 * reviewed one-time backfill) uses one tested path. */

export type ConvertResult =
  | { status: "converted"; eventId: string; occurrenceId: string; appearanceId: string }
  | { status: "skipped"; reason: "not_found" | "already_linked" | "canceled" | "source_event_exists" | "no_end"; eventId?: string }
  | { status: "error"; error: string };

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

export async function convertAppearanceToEvent(
  admin: SupabaseClient,
  appearanceId: string,
  deps: { uniqueEventSlug: (title: string) => Promise<string | null>; organizerName?: string | null }
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

  if (a.external_url) {
    const { data: existing } = await admin
      .from("events")
      .select("id")
      .eq("external_url", a.external_url)
      .is("trashed_at", null)
      .neq("publication_status", "rejected")
      .limit(1);
    const hit = ((existing ?? []) as { id: string }[])[0];
    if (hit) return { status: "skipped", reason: "source_event_exists", eventId: hit.id };
  }

  const slug = await deps.uniqueEventSlug(a.title);
  if (!slug) return { status: "error", error: "no_slug" };

  const { data: created, error } = await admin
    .from("events")
    .insert({
      name: a.title,
      slug,
      start_at: a.start_at,
      end_at: a.end_at,
      is_demo: true,
      publication_status: "pending_review",
      host_business_id: null,
      organizer_name: deps.organizerName ?? null,
      description: a.description,
      external_url: a.external_url,
      cover_image_url: a.flyer_image_url,
      venue_name: a.venue_name,
      address: a.address,
      city: a.city,
      state: a.state,
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
      start_at: a.start_at,
      end_at: a.end_at,
      location_id: a.location_id,
      venue_name: a.venue_name,
      address: a.address,
      city: a.city,
      state: a.state,
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
    .update({ event_id: eventId, event_occurrence_id: occurrenceId, source: "official_participation" })
    .eq("id", a.id)
    .is("event_id", null);
  if (linkError) return undo("link_failed");

  return { status: "converted", eventId, occurrenceId, appearanceId: a.id };
}
