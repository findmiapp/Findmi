import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import OnboardingProgress from "@/components/OnboardingProgress";
import { updateProfile } from "../../account/profile/actions";

export const metadata: Metadata = {
  title: "Personalize your Passbook",
  robots: { index: false },
};
// Session-sensitive, per-user content — must never be statically or
// ISR-cached.
export const dynamic = "force-dynamic";

const STEPS = ["Account", "Personalize", "Done"];

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-input text-primary placeholder:text-subtle focus:border-ink/30 focus:outline-none";
const primaryButtonClass =
  "flex h-12 w-full items-center justify-center rounded-2xl bg-findmi text-button font-bold uppercase text-white transition hover:bg-findmi-600";

/**
 * Join / Universal Onboarding pass — the Passbook path's light
 * personalization step. Reuses the existing `profiles` table and the
 * existing updateProfile Server Action (account/profile/actions.ts)
 * unchanged — no duplicate profile-write path, no new schema. Only
 * display_name and location_label are editable here: those are the two
 * fields that already have clean, existing infrastructure (display_name
 * is collected at signup; location_label is an existing free-text field).
 * Profile photo and consumer-interest tagging are intentionally omitted —
 * there is no upload flow or interests taxonomy today (see
 * updateProfile's own comment on avatar_url, and lib/types.ts's Profile
 * interface), and this pass's own instructions are to omit rather than
 * invent that infrastructure.
 *
 * phone/bio are NOT rendered as editable inputs here (this screen isn't
 * the place to re-collect them), but are still round-tripped as hidden
 * fields pre-filled with the visitor's current values — updateProfile
 * writes whatever the submitted form contains, so leaving them out of the
 * form entirely would silently null out a phone number signup already
 * required. This preserves existing data without changing updateProfile's
 * own semantics for its original caller, /account/profile.
 */
export default async function JoinPassbookPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signup?next=%2Fjoin%2Fpassbook");

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle<Profile>();

  return (
    <div className="mx-auto max-w-lg px-6 py-12 sm:py-16">
      <OnboardingProgress step={2} total={3} labels={STEPS} />

      <h1 className="mt-5 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
        Personalize your Passbook
      </h1>
      <p className="mt-2 text-sm text-ink/60">A couple of quick details — you can change these anytime.</p>

      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="mt-5 rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
        <form action={updateProfile} className="flex flex-col gap-4">
          <input type="hidden" name="from" value="/join/passbook" />
          <input type="hidden" name="next" value="/join/welcome" />
          <input type="hidden" name="phone" value={profile?.phone ?? ""} />
          <input type="hidden" name="bio" value={profile?.bio ?? ""} />

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
            Save &amp; Continue
          </button>
        </form>
      </div>

      <div className="mt-4 text-center">
        <Link href="/join/welcome" className="text-sm font-semibold text-ink/45 hover:text-ink/70">
          Skip for now
        </Link>
      </div>
    </div>
  );
}
