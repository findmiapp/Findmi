// Homepage Bulletin — data layer. See migration
// 20260929010000_homepage_bulletins.sql. Same founder-control philosophy
// as homepage_rows/discovery_pages: a real, admin-editable table, "at
// most one published" enforced both app-side (publishBulletin below) and
// by a DB partial unique index, no public route reads anything but the
// currently published row.
//
// Deliberately object-agnostic: destination_type/destination_id resolve
// against whichever FindMi object the founder picked (Business/Event/
// Location), or destination_url for a safe custom link — same
// route-vs-custom-link split lib/navigation.ts already uses for nav_items,
// just with more than one possible internal object type.
import { getSupabase } from "./supabase";
import { getAdminSupabase } from "./admin/supabase-admin";
import { validateCustomDestination } from "./navigation";

export const BULLETIN_DESTINATION_TYPES = ["business", "event", "location", "custom_url"] as const;
export type BulletinDestinationType = (typeof BULLETIN_DESTINATION_TYPES)[number];

export interface HomepageBulletin {
  id: string;
  eyebrow: string | null;
  headline: string;
  supporting_text: string | null;
  meta_text: string | null;
  thumbnail_url: string | null;
  cta_text: string | null;
  destination_type: BulletinDestinationType | null;
  destination_id: string | null;
  destination_url: string | null;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

/** Resolved for rendering — the one thing both the public homepage and the
 * admin preview actually need: a real headline plus an optional href
 * already resolved from whatever destination_type points at. Never
 * exposes a dead link — href is null whenever there's nothing safe/real
 * to point at, and HomepageBulletin.tsx renders no CTA in that case. */
export interface ResolvedHomepageBulletin {
  id: string;
  eyebrow: string | null;
  headline: string;
  supportingText: string | null;
  metaText: string | null;
  thumbnailUrl: string | null;
  ctaText: string | null;
  href: string | null;
  destinationType: BulletinDestinationType | null;
}

/** Batched-friendly (single row at a time is fine here — V1 only ever
 * resolves the one published Bulletin, or one being edited/previewed in
 * admin — never a list of many, so one small lookup query per call is not
 * an N+1 concern). Business/Event/Location slugs resolve to the same
 * public routes those pages already use elsewhere (/business/[slug],
 * /event/[slug], /location/[slug]) — no new routing invented. */
async function resolveDestinationHref(
  bulletin: Pick<HomepageBulletin, "destination_type" | "destination_id" | "destination_url">,
  supabase: ReturnType<typeof getSupabase>
): Promise<string | null> {
  const { destination_type, destination_id, destination_url } = bulletin;
  if (destination_type === "custom_url") {
    if (!destination_url) return null;
    const validated = validateCustomDestination(destination_url);
    return validated.ok ? validated.value : null;
  }
  if (!destination_id || !supabase) return null;

  if (destination_type === "business") {
    const { data } = await supabase.from("businesses").select("slug").eq("id", destination_id).maybeSingle();
    return data?.slug ? `/business/${data.slug}` : null;
  }
  if (destination_type === "event") {
    const { data } = await supabase.from("events").select("slug").eq("id", destination_id).maybeSingle();
    return data?.slug ? `/event/${data.slug}` : null;
  }
  if (destination_type === "location") {
    const { data } = await supabase.from("locations").select("slug").eq("id", destination_id).maybeSingle();
    return data?.slug ? `/location/${data.slug}` : null;
  }
  return null;
}

function toResolved(bulletin: HomepageBulletin, href: string | null): ResolvedHomepageBulletin {
  return {
    id: bulletin.id,
    eyebrow: bulletin.eyebrow,
    headline: bulletin.headline,
    supportingText: bulletin.supporting_text,
    metaText: bulletin.meta_text,
    thumbnailUrl: bulletin.thumbnail_url,
    ctaText: bulletin.cta_text,
    href,
    destinationType: bulletin.destination_type,
  };
}

/** Public homepage read — the anon client, gated by the "Public read
 * published homepage bulletins" RLS policy, so this can only ever return
 * the single published row (or none). */
export async function getPublishedHomepageBulletin(): Promise<ResolvedHomepageBulletin | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase
    .from("homepage_bulletins")
    .select("*")
    .eq("is_published", true)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const bulletin = data as HomepageBulletin;
  const href = await resolveDestinationHref(bulletin, supabase);
  return toResolved(bulletin, href);
}

/** Admin list — every saved Bulletin, newest first. */
export async function getAdminBulletins(): Promise<HomepageBulletin[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase.from("homepage_bulletins").select("*").order("created_at", { ascending: false });
  return (data ?? []) as HomepageBulletin[];
}

export async function getAdminBulletin(id: string): Promise<HomepageBulletin | null> {
  const supabase = getAdminSupabase();
  if (!supabase) return null;
  const { data } = await supabase.from("homepage_bulletins").select("*").eq("id", id).maybeSingle();
  return (data as HomepageBulletin | null) ?? null;
}

/** Admin preview — same resolution the public homepage uses, so the
 * create/edit screen's preview is never a second, drifting implementation. */
export async function resolveBulletinPreviewHref(
  bulletin: Pick<HomepageBulletin, "destination_type" | "destination_id" | "destination_url">
): Promise<string | null> {
  return resolveDestinationHref(bulletin, getAdminSupabase());
}

/** For the admin edit form's RelationField — the already-selected
 * Business/Event/Location's display label, so re-opening a saved
 * Bulletin shows what's already chosen instead of an empty search box.
 * Mirrors getCuratedItemPreviews' shape but adds "locations" (not one of
 * that helper's three supported content types). */
export async function getBulletinDestinationPreview(
  destinationType: BulletinDestinationType | null,
  destinationId: string | null
): Promise<{ value: string; label: string; sublabel?: string; image_url?: string | null } | null> {
  if (!destinationId) return null;
  const supabase = getAdminSupabase();
  if (!supabase) return null;

  if (destinationType === "business") {
    const { data } = await supabase.from("businesses").select("id, name, city, state, logo_url").eq("id", destinationId).maybeSingle();
    if (!data) return null;
    return { value: data.id, label: data.name, sublabel: [data.city, data.state].filter(Boolean).join(", ") || undefined, image_url: data.logo_url };
  }
  if (destinationType === "event") {
    const { data } = await supabase.from("events").select("id, name, venue_name").eq("id", destinationId).maybeSingle();
    if (!data) return null;
    return { value: data.id, label: data.name, sublabel: data.venue_name ?? undefined };
  }
  if (destinationType === "location") {
    const { data } = await supabase.from("locations").select("id, name, city, state").eq("id", destinationId).maybeSingle();
    if (!data) return null;
    return { value: data.id, label: data.name, sublabel: [data.city, data.state].filter(Boolean).join(", ") || undefined };
  }
  return null;
}
