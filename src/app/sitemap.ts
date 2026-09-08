import type { MetadataRoute } from "next";
import { getSupabase } from "@/lib/supabase";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://findmi.app";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    "",
    "/discover",
    "/businesses",
    "/events",
    "/locations",
    "/join",
    "/about",
    "/privacy",
    "/terms",
  ].map((path) => ({
    url: `${siteUrl}${path}`,
    lastModified: new Date(),
  }));

  const supabase = getSupabase();
  if (!supabase) return staticRoutes;

  // Public-visibility fix — this used to select every row with no filter
  // at all, so a paused/draft/pending/rejected/demo Business (and any
  // demo Event/Location) still got a sitemap.xml entry even though its
  // own page 404s (getBusinessBySlug/getEventBySlug/getLocationBySlug all
  // already gate on exactly these same columns). Businesses use both
  // is_demo and publication_status = "live" (see PUBLIC_BUSINESS_COLUMNS'
  // callers in lib/data.ts); Events/Locations are gated by is_demo alone
  // — publication_status is deliberately NOT a public-visibility gate for
  // Events (see getEventBySlug), and Locations have no publication_status
  // column at all. Same existing rules, not new lifecycle semantics.
  const [{ data: businesses }, { data: events }, { data: locations }] = await Promise.all([
    supabase.from("businesses").select("slug, updated_at").eq("is_demo", false).eq("publication_status", "live"),
    supabase.from("events").select("slug").eq("is_demo", false),
    supabase.from("locations").select("slug").eq("is_demo", false),
  ]);

  const businessRoutes: MetadataRoute.Sitemap = (businesses ?? []).map((b) => ({
    url: `${siteUrl}/business/${b.slug}`,
    lastModified: b.updated_at ? new Date(b.updated_at) : new Date(),
  }));

  const eventRoutes: MetadataRoute.Sitemap = (events ?? []).map((e) => ({
    url: `${siteUrl}/event/${e.slug}`,
  }));

  const locationRoutes: MetadataRoute.Sitemap = (locations ?? []).map((l) => ({
    url: `${siteUrl}/location/${l.slug}`,
  }));

  return [...staticRoutes, ...businessRoutes, ...eventRoutes, ...locationRoutes];
}
