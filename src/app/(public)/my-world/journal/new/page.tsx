import MomentComposer from "@/components/journal/MomentComposer";
import { getSupabase } from "@/lib/supabase";
import { emptyMomentInitial, type MomentPick } from "@/lib/moment-composer";
import { resolveEventMomentPrefill, type EventMomentPrefill } from "@/app/(public)/event/[slug]/eventMomentPrefill";

type JournalSearchResult = MomentPick;

/** Journal V1 — entry creation from existing Findmi context. Every
 * supplied id is validated server-side against the real row before it's
 * ever used as a prefill default (never trusted at face value) — an
 * invalid/unknown id is silently ignored rather than erroring the whole
 * page, so a stale or tampered link just lands on a normal blank Create
 * flow instead of breaking.
 *
 * Contextual Moment Composer V1 — each resolver now also returns the
 * entity's real public href (its slug was already one more column on the
 * exact same already-fetched row, no second query) so Cancel can send the
 * person back to where they actually came from instead of always landing
 * on the generic Journal archive. Kept separate from JournalSearchResult
 * itself (never adding `href`/`slug` to that broadly-used type) — this
 * page is the only thing that needs it. */
async function resolvePrefillLocation(id: string | undefined): Promise<{ result: JournalSearchResult; href: string } | null> {
  if (!id) return null;
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase
    .from("locations")
    .select("id, slug, name, city, state, logo_url, cover_image_url")
    .eq("id", id)
    .eq("is_demo", false)
    .maybeSingle();
  if (!data) return null;
  return {
    result: { value: data.id, label: data.name, sublabel: [data.city, data.state].filter(Boolean).join(", ") || undefined, image_url: data.logo_url ?? data.cover_image_url },
    href: `/location/${data.slug}`,
  };
}

async function resolvePrefillBusiness(id: string | undefined): Promise<{ result: JournalSearchResult; href: string } | null> {
  if (!id) return null;
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase
    .from("businesses")
    .select("id, slug, name, logo_url, is_demo, publication_status")
    .eq("id", id)
    .eq("is_demo", false)
    .eq("publication_status", "live")
    .maybeSingle();
  if (!data) return null;
  return { result: { value: data.id, label: data.name, image_url: data.logo_url }, href: `/business/${data.slug}` };
}

async function resolvePrefillProduct(id: string | undefined): Promise<{ result: JournalSearchResult; href: string } | null> {
  if (!id) return null;
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase
    .from("products")
    .select("id, slug, name, image_url, is_active, business:businesses(name, is_demo, publication_status)")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();
  if (!data) return null;
  const business = Array.isArray(data.business) ? (data.business[0] ?? null) : data.business;
  if (!business || business.is_demo || business.publication_status !== "live") return null;
  return { result: { value: data.id, label: data.name, sublabel: business.name, image_url: data.image_url }, href: `/product/${data.slug}` };
}

async function resolvePrefillEvent(id: string | undefined): Promise<{ result: JournalSearchResult; href: string; context: EventMomentPrefill } | null> {
  if (!id) return null;
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase
    .from("events")
    .select("id, slug, name, cover_image_url, city, state, is_demo, venue_name, address, host_business_id")
    .eq("id", id)
    .eq("is_demo", false)
    .maybeSingle();
  if (!data) return null;
  // Moments V2 — the Event's own date / Location / host, resolved only
  // where unambiguous, as removable prefills for this NEW Moment.
  const context = await resolveEventMomentPrefill(data);
  return {
    result: { value: data.id, label: data.name, sublabel: [data.city, data.state].filter(Boolean).join(", ") || undefined, image_url: data.cover_image_url },
    href: `/event/${data.slug}`,
    context,
  };
}

export default async function NewJournalEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string; business?: string; product?: string; event?: string }>;
}) {
  const params = await searchParams;
  const [locationPrefill, businessPrefill, productPrefill, eventPrefill] = await Promise.all([
    resolvePrefillLocation(params.location),
    resolvePrefillBusiness(params.business),
    resolvePrefillProduct(params.product),
    resolvePrefillEvent(params.event),
  ]);
  // Contextual Moment Composer V1 — Cancel returns to wherever this
  // composer was actually opened from; a blank /my-world/journal/new
  // visit (no prefill resolved) keeps the existing, correct fallback.
  const cancelHref = locationPrefill?.href ?? businessPrefill?.href ?? productPrefill?.href ?? eventPrefill?.href ?? "/my-world/journal";

  // Moments V2 — every contextual start is a PREFILL of the same composer,
  // never a separate workflow; everything prefilled stays removable.
  const initial = emptyMomentInitial();
  if (locationPrefill) initial.location = locationPrefill.result;
  if (businessPrefill) initial.businesses.push(businessPrefill.result);
  if (productPrefill) initial.products.push(productPrefill.result);
  const autoResolveEventIds: string[] = [];
  if (eventPrefill) {
    const { occurrence, location, hostBusiness } = eventPrefill.context;
    initial.events.push({
      ...eventPrefill.result,
      origin: "where",
      occurrence: occurrence
        ? { id: occurrence.id, event_id: occurrence.event_id, start_at: occurrence.start_at, end_at: occurrence.end_at, timezone: occurrence.timezone, location_id: occurrence.location_id }
        : null,
    });
    if (occurrence) {
      initial.entryDate = occurrence.localDate;
      initial.entryTime = occurrence.localTime;
    } else {
      autoResolveEventIds.push(eventPrefill.result.value);
    }
    if (!initial.location && location) initial.location = location;
    if (hostBusiness && !initial.businesses.some((b) => b.value === hostBusiness.value)) initial.businesses.push(hostBusiness);
    initial.title = eventPrefill.result.label;
  }

  return <MomentComposer mode="create" initial={initial} cancelHref={cancelHref} autoResolveEventIds={autoResolveEventIds} />;
}
