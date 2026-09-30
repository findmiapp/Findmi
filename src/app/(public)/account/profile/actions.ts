"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { normalizeUsPhone } from "@/lib/phone";
import { getSafeRedirect } from "@/lib/auth/safe-redirect";

export async function updateProfile(formData: FormData) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Defense in depth — middleware already gates /account, but every
  // Server Action re-checks independently, same discipline
  // requireAdminSupabase() established for the founder admin surface.
  if (!user) redirect("/login");

  // Join / Universal Onboarding pass — two optional, backward-compatible
  // fields. Left blank (every existing caller — the plain /account/profile
  // form), `from`/`next` default to this action's original, hardcoded
  // /account/profile behavior. /join/passbook is the one caller that sets
  // both: `from` sends a validation error back to /join/passbook instead
  // of /account/profile, and `next` sends a successful save on to
  // /join/welcome instead. Both still go through getSafeRedirect, same as
  // every other client-supplied redirect target in this app, since a
  // hidden form field is still visitor-controllable.
  const fromRaw = String(formData.get("from") ?? "").trim();
  const from = fromRaw ? getSafeRedirect(fromRaw) : "/account/profile";
  const nextRaw = String(formData.get("next") ?? "").trim();
  const next = nextRaw ? getSafeRedirect(nextRaw) : "/account/profile?saved=1";

  const displayNameRaw = String(formData.get("display_name") ?? "").trim();

  // Require Cell Number at Signup pass — optional here (existing accounts
  // may have none yet, and this pass must never lock them out of editing
  // the rest of their profile — see that pass's own Section 6). Blank
  // clears it back to null; anything non-blank must normalize to a real
  // NANP number, same rule signup itself enforces.
  const phoneRaw = String(formData.get("phone") ?? "").trim();
  let phone: string | null = null;
  if (phoneRaw) {
    phone = normalizeUsPhone(phoneRaw);
    if (!phone) {
      redirect(`${from}?error=${encodeURIComponent("Enter a valid U.S. or Canada cell number.")}`);
    }
  }

  const bioRaw = String(formData.get("bio") ?? "").trim();
  if (bioRaw.length > 280) {
    redirect(`${from}?error=${encodeURIComponent("Bio must be 280 characters or fewer.")}`);
  }

  const locationRaw = String(formData.get("location_label") ?? "").trim();
  if (locationRaw.length > 80) {
    redirect(`${from}?error=${encodeURIComponent("Location must be 80 characters or fewer.")}`);
  }

  const patch: Record<string, unknown> = {
    display_name: displayNameRaw || null,
    phone,
    bio: bioRaw || null,
    location_label: locationRaw || null,
  };
  // avatar_url is intentionally not part of this form — the field is
  // hidden from the UI for now (no upload flow yet), so this update must
  // not touch it, or every save would silently null out any existing
  // value.

  const { error } = await supabase.from("profiles").update(patch).eq("id", user.id);
  if (error) redirect(`${from}?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/account/profile");
  redirect(next);
}

export async function signOut() {
  const supabase = await getServerSupabase();
  await supabase.auth.signOut();
  redirect("/");
}
