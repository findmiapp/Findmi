import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { updateProfile, signOut } from "./actions";

export const metadata: Metadata = {
  title: "Account",
  robots: { index: false },
};
// Authenticated, per-user content — must never be statically or
// ISR-cached; every response here is specific to whoever is signed in.
export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";

export default async function AccountPage({
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
  if (!user) redirect("/login?next=/account");

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle<Profile>();

  return (
    <div className="mx-auto max-w-md px-6 py-14">
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Your FindMi account</p>
      <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">Account</h1>
      <p className="mt-2 text-sm text-ink/50">{user.email}</p>

      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      {saved && !error && (
        <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved.
        </p>
      )}

      <form action={updateProfile} className="mt-6 flex flex-col gap-4">
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
          <span className="mb-1.5 block text-sm font-medium text-ink">Avatar URL</span>
          <input
            type="text"
            name="avatar_url"
            defaultValue={profile?.avatar_url ?? ""}
            placeholder="https://…"
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          className="mt-2 rounded-full bg-findmi px-5 py-3 text-sm font-bold text-white transition hover:bg-findmi-600"
        >
          Save
        </button>
      </form>

      <form action={signOut} className="mt-8 border-t border-black/5 pt-6">
        <button type="submit" className="text-xs font-semibold text-ink/50 hover:text-ink">
          Sign Out
        </button>
      </form>
    </div>
  );
}
