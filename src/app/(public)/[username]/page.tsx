import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { normalizeUsername } from "@/lib/username";
import { getSupabase } from "@/lib/supabase";
import type { HandleEntityType } from "@/lib/handles";
import { generateBusinessMetadata, BusinessPublicView } from "../business/[slug]/BusinessPublicView";
import { generateLocationMetadata, LocationPublicView } from "../location/[slug]/LocationPublicView";
import { generateEventMetadata, EventPublicView } from "../event/[slug]/EventPublicView";

export const revalidate = 60;

// FindMi Global Handle Registry — the public vanity entry point:
// findmi.app/[username] resolves through the central handles registry
// (public_handles — handle/entity_type/entity_id only, never id/user_id)
// to find out WHICH Business/Location/Event this handle belongs to, then
// renders that entity's real public page DIRECTLY at this URL (Vanity URL
// Rendering pass) — no redirect, so findmi.app/<handle> stays in the
// address bar. Personal accounts/profiles do NOT participate in this
// registry or this route (Product Model Correction pass) — a username
// here is always a public entity's identity, never a person's. Next.js's
// own routing already gives every literal top-level segment (/find,
// /account, /admin, /events, ...) priority over this catch-all dynamic
// route — nothing here needs to special-case those; an unresolved handle
// is nothing more than a normal 404 for a page that doesn't exist at this
// segment.
//
// Vanity URL Rendering pass — business/[slug], event/[slug], and
// location/[slug] each now export their real render tree as a plain
// {Business,Location,Event}PublicView({ slug }) function (see those
// files) instead of embedding it directly in their own page.tsx. This
// route and each canonical route both call straight into that same
// function/generateXMetadata pair — one implementation, two entry
// points, never two independently maintained page trees. Because the
// view functions call the exact same getBusinessBySlug/getLocationBySlug/
// getEventBySlug used everywhere else, every existing publication/
// visibility rule (live-only, is_demo exclusion, the Business owner-
// preview fallback) applies identically here — a handle pointing at a
// hidden/unpublished/deleted entity still resolves to nothing a normal
// visitor can see.
async function resolveEntitySlug(entityType: HandleEntityType, entityId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const table = entityType === "business" ? "businesses" : entityType === "location" ? "locations" : "events";
  const { data } = await supabase.from(table).select("slug").eq("id", entityId).maybeSingle();
  return data?.slug ?? null;
}

async function resolveHandle(username: string) {
  const handle = normalizeUsername(username);
  if (!handle) return null;
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.from("public_handles").select("entity_type, entity_id").eq("handle", handle).maybeSingle();
  return data as { entity_type: HandleEntityType; entity_id: string } | null;
}

async function resolveVanitySlug(username: string): Promise<{ entityType: HandleEntityType; slug: string } | null> {
  const resolved = await resolveHandle(username);
  if (!resolved) return null;
  const slug = await resolveEntitySlug(resolved.entity_type, resolved.entity_id);
  if (!slug) return null;
  return { entityType: resolved.entity_type, slug };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const resolved = await resolveVanitySlug(username);
  if (!resolved) return { title: "Not found" };

  if (resolved.entityType === "business") return generateBusinessMetadata(resolved.slug);
  if (resolved.entityType === "location") return generateLocationMetadata(resolved.slug);
  return generateEventMetadata(resolved.slug);
}

export default async function VanityUsernamePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const resolved = await resolveVanitySlug(username);
  if (!resolved) notFound();

  if (resolved.entityType === "business") return <BusinessPublicView slug={resolved.slug} />;
  if (resolved.entityType === "location") return <LocationPublicView slug={resolved.slug} />;
  return <EventPublicView slug={resolved.slug} />;
}
