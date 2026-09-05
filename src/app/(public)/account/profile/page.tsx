import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import AccountNav from "../AccountNav";
import { updateProfile, signOut } from "./actions";

export const metadata: Metadata = {
  title: "Profile",
  robots: { index: false },
};
// Authenticated, per-user content — must never be statically or
// ISR-cached; every response here is specific to whoever is signed in.
export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";
const primaryButtonClass =
  "flex h-12 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Middleware already gates this route; this is the same
  // defense-in-depth re-check every Server Action here also does.
  if (!user) redirect("/login?next=/account/profile");

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle<Profile>();

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <AccountNav />

      <div className="mx-auto max-w-md">
        <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Your FindMi account</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">Profile</h1>
        <p className="mt-2 text-sm text-ink/50">{user.email}</p>

        {error && (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        )}
        {saved && !error && (
          <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
            Profile updated.
          </p>
        )}

        {/* User Identity + Follow Foundation pass — a username is what
            turns this private account record into a public FindMi
            identity (@username, shown to Business/Event owners as a
            follower and visitable at /user/[username]) — never required
            to use the rest of FindMi (no signup blocker), so this reads
            as an invitation, not a warning, when one hasn't been chosen
            yet. */}
        {profile?.username ? (
          <p className="mt-4 text-sm text-ink/50">
            Your public profile:{" "}
            <Link href={`/user/${profile.username}`} className="font-semibold text-findmi-700 hover:underline">
              @{profile.username}
            </Link>
          </p>
        ) : (
          <p className="mt-4 rounded-xl border border-findmi/20 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
            Choose a username below to finish setting up your public FindMi profile — optional, but it&rsquo;s how
            businesses and events you follow will recognize you.
          </p>
        )}

        <div className="mt-4 rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
          <form action={updateProfile} className="flex flex-col gap-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">Display name</span>
              <input
                type="text"
                name="display_name"
                defaultValue={profile?.display_name ?? ""}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">Username</span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink/40">@</span>
                <input
                  type="text"
                  name="username"
                  defaultValue={profile?.username ?? ""}
                  placeholder={profile?.username ? undefined : "choose_a_username"}
                  pattern="[a-z0-9_]{3,20}"
                  maxLength={20}
                  className={inputClass}
                />
              </div>
              <span className="mt-1 block text-xs text-ink/45">
                3-20 characters: lowercase letters, numbers, underscores. Leave blank to keep things as they are.
              </span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">Short bio (optional)</span>
              <textarea
                name="bio"
                defaultValue={profile?.bio ?? ""}
                rows={3}
                maxLength={280}
                className={`${inputClass} resize-y`}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">Location (optional)</span>
              <input
                type="text"
                name="location_label"
                defaultValue={profile?.location_label ?? ""}
                placeholder="e.g. Brooklyn, NY"
                maxLength={80}
                className={inputClass}
              />
              <span className="mt-1 block text-xs text-ink/45">A general area only — never an exact address.</span>
            </label>
            <button type="submit" className={`mt-1 ${primaryButtonClass}`}>
              Save Changes
            </button>
          </form>
        </div>

        <form action={signOut} className="mt-6 text-center">
          <button type="submit" className="text-xs font-semibold text-ink/40 hover:text-ink/70">
            Sign Out
          </button>
        </form>
      </div>
    </div>
  );
}
