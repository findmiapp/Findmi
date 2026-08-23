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

  const [{ data: businesses }, { data: events }, { data: locations }] = await Promise.all([
    supabase.from("businesses").select("slug, updated_at"),
    supabase.from("events").select("slug"),
    supabase.from("locations").select("slug"),
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
