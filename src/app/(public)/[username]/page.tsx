import { notFound, redirect } from "next/navigation";
import { normalizeUsername } from "@/lib/username";
import { getSupabase } from "@/lib/supabase";
import type { HandleEntityType } from "@/lib/handles";

export const revalidate = 60;

// FindMi Global Handle Registry — the public vanity entry point:
// findmi.app/[username] resolves through the central handles registry
// (public_handles — handle/entity_type/entity_id only, never id/user_id)
// to find out WHICH Business/Location/Event this handle belongs to, then
// redirects to the existing canonical detail route. Personal accounts/
// profiles do NOT participate in this registry or this route (Product
// Model Correction pass) — a username here is always a public entity's
// identity, never a person's. Next.js's own routing already gives every
// literal top-level segment (/find, /account, /admin, /events, ...)
// priority over this catch-all dynamic route — nothing here needs to
// special-case those; an unresolved handle is nothing more than a normal
// 404 for a page that doesn't exist at this segment.
//
// Redirect rather than render inline: business/[slug], event/[slug], and
// location/[slug] are large, independently evolving render trees (Pro/
// Free gating, occurrence scheduling, owner-preview fallbacks, JSON-LD).
// Extracting them into a second shared renderer just for this route would
// be exactly the "fork two independently maintained versions of every
// page" this pass avoids; a temporary redirect (never permanent — a
// handle can be released/reclaimed) reuses that existing, already-correct
// rendering with zero duplication and zero added risk.
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

export default async function VanityUsernamePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const resolved = await resolveHandle(username);
  if (!resolved) notFound();

  const slug = await resolveEntitySlug(resolved.entity_type, resolved.entity_id);
  if (!slug) notFound();

  redirect(`/${resolved.entity_type}/${slug}`);
}
