import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import PublicProfileView from "@/components/PublicProfileView";
import { getPublicProfileByUsername } from "@/lib/profiles";
import { normalizeUsername } from "@/lib/username";
import { getSupabase } from "@/lib/supabase";

export const revalidate = 60;

// FindMi Global Handle Registry — the public vanity entry point:
// findmi.app/[username] resolves through the central handles registry
// (public_handles — handle/entity_type/entity_id only, never id/user_id;
// same privacy boundary public_profiles already established) to find out
// WHAT this handle belongs to, then either renders it directly (Person —
// its public page is small/stable enough to safely share via
// PublicProfileView) or redirects to the existing canonical detail route
// (Business/Location/Event). Next.js's own routing already gives every
// literal top-level segment (/find, /account, /admin, /events, ...)
// priority over this catch-all dynamic route — nothing here needs to
// special-case those; an unresolved handle is nothing more than a normal
// 404 for a page that doesn't exist at this segment.
//
// Business/Location/Event redirect rather than render inline: those
// three detail pages (business/[slug], event/[slug], location/[slug])
// are large, independently evolving render trees (Pro/Free gating,
// occurrence scheduling, owner-preview fallbacks, JSON-LD). Extracting
// them into a second shared renderer just for this route would be
// exactly the "fork two independently maintained versions of every
// page" this pass was told to avoid; a temporary redirect (never
// permanent — a handle can be released/reclaimed) reuses that existing,
// already-correct rendering with zero duplication and zero added risk.
async function resolveEntitySlug(entityType: "business" | "location" | "event", entityId: string): Promise<string | null> {
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
  return data as { entity_type: "person" | "business" | "location" | "event"; entity_id: string } | null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const handle = normalizeUsername(username);
  if (handle) {
    const profile = await getPublicProfileByUsername(handle);
    if (profile) {
      return {
        title: profile.display_name ? `${profile.display_name} (@${profile.username})` : `@${profile.username}`,
        description: profile.bio ?? `@${profile.username} on Findmi.`,
      };
    }
  }
  return {};
}

export default async function VanityUsernamePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const handle = normalizeUsername(username);
  if (!handle) notFound();

  // Checked first since it's the one entity type rendered inline here —
  // avoids a registry round trip for the common Person case, and
  // getPublicProfileByUsername is itself the same safe, existing read
  // /user/[username] already uses.
  const profile = await getPublicProfileByUsername(handle);
  if (profile) return <PublicProfileView profile={profile} />;

  const resolved = await resolveHandle(handle);
  // "person" can't legitimately reach here (getPublicProfileByUsername
  // above already covers every person handle, kept in sync by
  // claim_person_handle) — treated as unresolved rather than cast/guessed.
  if (!resolved || resolved.entity_type === "person") notFound();

  const slug = await resolveEntitySlug(resolved.entity_type, resolved.entity_id);
  if (!slug) notFound();

  redirect(`/${resolved.entity_type}/${slug}`);
}
