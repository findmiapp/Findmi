"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { bool, errorRedirectUrl, localDateTimeToIso, num, str } from "@/lib/admin/form-helpers";
import { validateCustomDestination } from "@/lib/navigation";
import { isAreaInMarket } from "@/lib/admin/market-areas";
import { formatDateShortInZone, formatTimeInZone } from "@/lib/format";

export async function saveAppearance(id: string | null, formData: FormData) {
  const editPath = id ? `/admin/appearances/${id}` : "/admin/appearances/new";
  const supabase = await requireAdminSupabase();

  const businessId = str(formData, "business_id");
  const title = str(formData, "title");
  const startLocal = str(formData, "start_at");
  const endLocal = str(formData, "end_at");
  if (!businessId || !title || !startLocal) {
    redirect(errorRedirectUrl(editPath, "Business, title, and start date/time are required."));
  }
  // End Date & Time is required, not optional — same active-duration
  // policy as events (see the active-event visibility bug fix). Without a
  // real end time the app has no honest way to know an appearance is
  // still happening, so a missing/invalid end can't be silently defaulted
  // or guessed here; it has to block the save with a clear message.
  if (!endLocal) {
    redirect(errorRedirectUrl(editPath, "End date/time is required — Findmi uses it to know when the appearance is over."));
  }
  const startIso = localDateTimeToIso(startLocal);
  const endIso = localDateTimeToIso(endLocal);
  if (!startIso || !endIso || new Date(endIso) <= new Date(startIso)) {
    redirect(errorRedirectUrl(editPath, "End date/time must be after the start date/time."));
  }

  const eventId = str(formData, "event_id"); // "" means "no event" — the select's blank option
  const requestedOccurrenceId = eventId ? str(formData, "event_occurrence_id") : null;

  // Same internal-path-or-https:// validation every other founder-entered
  // destination on the site uses (see businesses/actions.ts's bulletin_url)
  // — never a second, parallel URL-safety check.
  const externalUrlRaw = str(formData, "external_url");
  let externalUrl: string | null = null;
  if (externalUrlRaw) {
    const result = validateCustomDestination(externalUrlRaw);
    if (!result.ok) redirect(errorRedirectUrl(editPath, `External Link: ${result.error}`));
    externalUrl = result.value;
  }

  // Event + Appearance Geography Completion pass — market_id/market_area_id
  // are ONLY meaningful for a standalone appearance. An event-linked
  // appearance's effective geography is always resolved from its Event
  // (see getFindMiHereFeed) — storing a value here too would just be a
  // second copy that could silently drift, so it's forced null instead.
  // market_area_id, when present, must belong to market_id — the same
  // invariant events.market_id/market_area_id already enforces in
  // application code, never a DB constraint.
  const marketId = eventId ? null : str(formData, "market_id");
  let areaId = eventId ? null : str(formData, "market_area_id");
  if (areaId && (!marketId || !(await isAreaInMarket(areaId, marketId)))) areaId = null;

  // Event ↔ Where You'll Be Sync Fix pass — when a Related Findmi Event is
  // linked, that Event (or its selected occurrence) is authoritative for
  // title/date/venue, never a second, independently-typed copy that can
  // drift. Root cause of the Perk Up Fest/Viktor Gal Shop QA bug: an admin
  // hand-retyped the date here and landed a day off, with city/state left
  // blank. The admin-facing form already auto-fills + locks these fields
  // once an Event is picked (see AppearanceEventFields.tsx), so this is a
  // server-side GUARANTEE on top of that UX, not just a convenience — the
  // values below always win over whatever was submitted for the same
  // fields whenever a real event_id is present. A stale/mismatched
  // requestedOccurrenceId (doesn't belong to eventId) is silently ignored
  // and falls back to the event's own fields, same fail-open posture the
  // rest of this action already uses for a bad market/area pairing above.
  let derivedFields: {
    title: string;
    start_at: string;
    end_at: string;
    venue_name: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null = null;
  let resolvedOccurrenceId: string | null = null;
  let eventSlug: string | null = null;

  if (eventId) {
    const { data: event } = await supabase
      .from("events")
      .select("name, slug, start_at, end_at, venue_name, address, city, state, latitude, longitude")
      .eq("id", eventId)
      .maybeSingle();
    if (event) {
      eventSlug = event.slug;
      if (requestedOccurrenceId) {
        const { data: occurrence } = await supabase
          .from("event_occurrences")
          .select("id, start_at, end_at, location_id")
          .eq("id", requestedOccurrenceId)
          .eq("event_id", eventId)
          .maybeSingle();
        if (occurrence) {
          resolvedOccurrenceId = occurrence.id;
          let venue = {
            venue_name: event.venue_name,
            address: event.address,
            city: event.city,
            state: event.state,
            latitude: event.latitude,
            longitude: event.longitude,
          };
          if (occurrence.location_id) {
            const { data: location } = await supabase
              .from("locations")
              .select("name, address, city, state, latitude, longitude")
              .eq("id", occurrence.location_id)
              .maybeSingle();
            if (location) {
              venue = {
                venue_name: location.name,
                address: location.address,
                city: location.city,
                state: location.state,
                latitude: location.latitude,
                longitude: location.longitude,
              };
            }
          }
          derivedFields = { title: event.name, start_at: occurrence.start_at, end_at: occurrence.end_at, ...venue };
        }
      }
      if (!derivedFields) {
        derivedFields = {
          title: event.name,
          start_at: event.start_at,
          end_at: event.end_at,
          venue_name: event.venue_name,
          address: event.address,
          city: event.city,
          state: event.state,
          latitude: event.latitude,
          longitude: event.longitude,
        };
      }
    }
  }

  const payload = {
    business_id: businessId,
    event_id: eventId,
    event_occurrence_id: resolvedOccurrenceId,
    title: derivedFields?.title ?? title,
    description: str(formData, "description"),
    start_at: derivedFields?.start_at ?? startIso,
    end_at: derivedFields?.end_at ?? endIso,
    venue_name: derivedFields ? derivedFields.venue_name : str(formData, "venue_name"),
    address: derivedFields ? derivedFields.address : str(formData, "address"),
    city: derivedFields ? derivedFields.city : str(formData, "city"),
    state: derivedFields ? derivedFields.state : str(formData, "state"),
    status: str(formData, "status") ?? "confirmed",
    is_featured: bool(formData, "is_featured"),
    bulletin_text: str(formData, "bulletin_text"),
    show_on_home: bool(formData, "show_on_home"),
    home_sort_order: num(formData, "home_sort_order"),
    external_url: externalUrl,
    flyer_image_url: str(formData, "flyer_image_url"),
    market_id: marketId,
    market_area_id: areaId,
    ...(derivedFields ? { latitude: derivedFields.latitude, longitude: derivedFields.longitude } : {}),
  };

  let appearanceId = id;
  if (appearanceId) {
    const { error } = await supabase.from("appearances").update(payload).eq("id", appearanceId);
    if (error) redirect(errorRedirectUrl(editPath, error.message));
  } else {
    const { data, error } = await supabase
      .from("appearances")
      .insert(payload)
      .select("id")
      .single();
    if (error || !data) {
      redirect(errorRedirectUrl(editPath, error?.message ?? "Could not create appearance."));
    }
    appearanceId = data.id;
  }

  // Linked Where You'll Be → Participation Reconciliation — an admin
  // deliberately linking an appearance to a real, existing Findmi Event is
  // an explicit "this business WILL BE here" fact, not merely an
  // organizer invitation (see this pass's own reasoning) — so it upserts
  // event_businesses/event_occurrence_businesses at 'approved', the same
  // established status value the rest of this admin surface already uses
  // (never a new status). ignoreDuplicates means an existing row's status
  // — including a prior explicit 'declined' — is never overwritten or
  // downgraded/upgraded by this; it's a no-op the moment a canonical
  // relationship already exists (Case 3's no-duplicate-on-retry
  // requirement). Only fires for a 'confirmed' appearance — a merely
  // 'tentative' or already-'canceled' one never becomes public roster
  // participation just from being linked.
  if (eventId && payload.status === "confirmed") {
    if (resolvedOccurrenceId) {
      await supabase
        .from("event_occurrence_businesses")
        .upsert(
          { occurrence_id: resolvedOccurrenceId, business_id: businessId, status: "approved" },
          { onConflict: "occurrence_id,business_id", ignoreDuplicates: true }
        );
    } else {
      await supabase
        .from("event_businesses")
        .upsert(
          { event_id: eventId, business_id: businessId, status: "approved" },
          { onConflict: "event_id,business_id", ignoreDuplicates: true }
        );
    }
  }

  revalidatePath("/admin/appearances");
  revalidatePath("/");
  revalidatePath("/find");
  revalidatePath("/discover");
  if (eventId) {
    revalidatePath("/admin/events");
    revalidatePath(`/admin/events/${eventId}`);
    if (eventSlug) revalidatePath(`/event/${eventSlug}`);
  }
  redirect(`/admin/appearances/${appearanceId}?saved=1`);
}

export interface EventLinkOccurrenceOption {
  id: string;
  label: string;
  start_at: string;
  end_at: string;
  venue_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
}

export interface EventLinkData {
  title: string;
  start_at: string;
  end_at: string;
  venue_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  occurrences: EventLinkOccurrenceOption[];
}

/** Existing-Event Autofill pass — the read half of the Perk Up Fest/
 * Viktor Gal Shop QA fix: lets AppearanceEventFields.tsx (a client
 * component, not a plain form) fetch one Event's own canonical
 * title/date/venue — plus, when it has occurrence rows, each date's own
 * resolved venue — the instant the "Related Findmi Event" picker's
 * selection changes, so the rest of the form can autofill instead of
 * making the admin retype data Findmi already has. Called directly as a
 * Server Action RPC (same established pattern as
 * ParticipationRoster.tsx's addOccurrenceVendor call), never through a
 * <form>. Occurrence venue resolution mirrors addAppearanceFromEvent's own
 * occ branch exactly: the occurrence's own linked Location wins, falling
 * back to the parent Event's venue fields — never a second, divergent
 * resolution rule. saveAppearance re-derives this same data server-side
 * on save regardless of what this returns, so a stale client-side result
 * here can never persist incorrect data. */
export async function getEventLinkDataForAppearance(eventId: string): Promise<EventLinkData | null> {
  const supabase = await requireAdminSupabase();
  const { data: event } = await supabase
    .from("events")
    .select("name, start_at, end_at, venue_name, address, city, state")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return null;

  const { data: occurrenceRows } = await supabase
    .from("event_occurrences")
    .select("id, start_at, end_at, location_id, timezone")
    .eq("event_id", eventId)
    .order("start_at", { ascending: true });
  const rows = occurrenceRows ?? [];

  const locationIds = Array.from(new Set(rows.map((o) => o.location_id).filter((v): v is string => Boolean(v))));
  const locationsById = new Map<
    string,
    { name: string; address: string | null; city: string | null; state: string | null }
  >();
  if (locationIds.length > 0) {
    const { data: locs } = await supabase.from("locations").select("id, name, address, city, state").in("id", locationIds);
    for (const l of locs ?? []) locationsById.set(l.id, l);
  }

  const occurrences: EventLinkOccurrenceOption[] = rows.map((o) => {
    const loc = o.location_id ? locationsById.get(o.location_id) : undefined;
    return {
      id: o.id,
      label: `${formatDateShortInZone(o.start_at, o.timezone)} · ${formatTimeInZone(o.start_at, o.timezone)}`,
      start_at: o.start_at,
      end_at: o.end_at,
      venue_name: loc?.name ?? event.venue_name,
      address: loc?.address ?? event.address,
      city: loc?.city ?? event.city,
      state: loc?.state ?? event.state,
    };
  });

  return {
    title: event.name,
    start_at: event.start_at,
    end_at: event.end_at,
    venue_name: event.venue_name,
    address: event.address,
    city: event.city,
    state: event.state,
    occurrences,
  };
}

export async function deleteAppearance(id: string) {
  const supabase = await requireAdminSupabase();
  await supabase.from("appearances").delete().eq("id", id);
  revalidatePath("/admin/appearances");
  revalidatePath("/");
  revalidatePath("/find");
  redirect("/admin/appearances");
}

// ── Admin Where I'll Be Review Inbox V1 ─────────────────────────────────
// admin_reviewed_at is Admin ACKNOWLEDGEMENT only — never moderation. These
// three actions touch that one column and nothing else: no status change,
// no visibility change, no Event/participation/Market-Area write. No
// redirect (unlike saveAppearance/deleteAppearance above) — these are
// invoked from plain forms on the list itself, so revalidatePath alone is
// enough for Next.js to refresh the current URL (filters/search intact)
// without navigating away.

export async function markAppearanceReviewed(id: string) {
  const supabase = await requireAdminSupabase();
  await supabase.from("appearances").update({ admin_reviewed_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/appearances");
}

export async function markAppearanceUnreviewed(id: string) {
  const supabase = await requireAdminSupabase();
  await supabase.from("appearances").update({ admin_reviewed_at: null }).eq("id", id);
  revalidatePath("/admin/appearances");
}

/** Bulk review — "ids" is always the exact set of currently-selected,
 * currently-VISIBLE (rendered on this page load) appearance ids the
 * client sent, never a server-side "select everything matching the
 * filter" — see AppearanceReviewList's own doc comment for why. */
export async function markAppearancesReviewed(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  if (ids.length === 0) return;
  await supabase.from("appearances").update({ admin_reviewed_at: new Date().toISOString() }).in("id", ids);
  revalidatePath("/admin/appearances");
}
