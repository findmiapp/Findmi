import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PublicProfileView from "@/components/PublicProfileView";
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
    description: profile.bio ?? `@${profile.username} on Findmi.`,
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

  return <PublicProfileView profile={profile} />;
}
