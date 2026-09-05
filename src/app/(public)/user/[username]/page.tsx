import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SupabaseImage from "@/components/SupabaseImage";
import { getPublicProfileByUsername } from "@/lib/profiles";

export const revalidate = 60;

// User Identity + Follow Foundation pass — the minimal public identity
// surface: @username, display name, avatar, optional bio/coarse location.
// Reads only PublicProfile's own columns (see lib/profiles.ts) — there is
// no path here to email/phone/auth id/payment data/owned-business
// internals, by construction, not by a filter that could later be
// loosened. Not a discovery/social feed page — just enough for a
// Business/Event owner (or another visitor) to recognize who this is.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const profile = await getPublicProfileByUsername(username);
  if (!profile) return { title: "Profile not found" };
  return {
    title: profile.display_name ? `${profile.display_name} (@${profile.username})` : `@${profile.username}`,
    description: profile.bio ?? `@${profile.username} on FindMi.`,
  };
}

export default async function PublicUserProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const profile = await getPublicProfileByUsername(username);
  if (!profile) notFound();

  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <div className="flex items-center gap-4">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full bg-mist">
          {profile.avatar_url && (
            <SupabaseImage src={profile.avatar_url} alt={profile.display_name ?? profile.username} fill sizes="80px" className="object-cover" />
          )}
        </div>
        <div className="min-w-0">
          {profile.display_name && (
            <h1 className="truncate font-display text-xl font-bold tracking-tight text-ink">{profile.display_name}</h1>
          )}
          <p className="truncate text-sm text-ink/50">@{profile.username}</p>
        </div>
      </div>

      {profile.bio && <p className="mt-4 text-sm text-ink/70">{profile.bio}</p>}
      {profile.location_label && <p className="mt-2 text-xs text-ink/45">{profile.location_label}</p>}
    </div>
  );
}
