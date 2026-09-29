import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { formatUsPhone } from "@/lib/phone";
import AccountNav from "../AccountNav";
import SignOutConfirm from "@/components/SignOutConfirm";
import { updateProfile, signOut } from "./actions";

export const metadata: Metadata = {
  title: "Profile",
  robots: { index: false },
};
// Authenticated, per-user content — must never be statically or
// ISR-cached; every response here is specific to whoever is signed in.
export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-input text-primary placeholder:text-subtle focus:border-ink/30 focus:outline-none";
const primaryButtonClass =
  "flex h-12 w-full items-center justify-center rounded-2xl bg-findmi text-button font-bold uppercase text-white transition hover:bg-findmi-600";

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
        <p className="text-label font-bold uppercase text-accent">Your Findmi account</p>
        <h1 className="mt-1 font-display text-page-title font-bold text-primary">Profile</h1>
        <p className="mt-2 text-body text-muted">{user.email}</p>

        {error && (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-body text-red-700">{error}</p>
        )}
        {saved && !error && (
          <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-body text-accent">
            Profile updated.
          </p>
        )}

        <div className="mt-4 rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
          <form action={updateProfile} className="flex flex-col gap-4">
            <label className="block">
              <span className="mb-1.5 block text-body font-medium text-primary">Display name</span>
              <input
                type="text"
                name="display_name"
                defaultValue={profile?.display_name ?? ""}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-body font-medium text-primary">Cell Number</span>
              <input
                type="tel"
                name="phone"
                inputMode="tel"
                defaultValue={formatUsPhone(profile?.phone)}
                placeholder="(917) 555-1234"
                autoComplete="tel"
                className={inputClass}
              />
              <span className="mt-1 block text-metadata text-subtle">
                {profile?.phone
                  ? "Used for important account updates, never shared publicly."
                  : "Add a cell number for important account updates, never shared publicly."}
              </span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-body font-medium text-primary">Short bio (optional)</span>
              <textarea
                name="bio"
                defaultValue={profile?.bio ?? ""}
                rows={3}
                maxLength={280}
                className={`${inputClass} resize-y`}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-body font-medium text-primary">Location (optional)</span>
              <input
                type="text"
                name="location_label"
                defaultValue={profile?.location_label ?? ""}
                placeholder="e.g. Brooklyn, NY"
                maxLength={80}
                className={inputClass}
              />
              <span className="mt-1 block text-metadata text-subtle">A general area only, never an exact address.</span>
            </label>
            <button type="submit" className={`mt-1 ${primaryButtonClass}`}>
              Save Changes
            </button>
          </form>
        </div>

        <div className="mt-6 text-center">
          <SignOutConfirm action={signOut} className="text-metadata font-semibold text-subtle hover:text-muted">
            Sign Out
          </SignOutConfirm>
        </div>
      </div>
    </div>
  );
}
