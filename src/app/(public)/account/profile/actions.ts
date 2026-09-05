"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { validateUsername } from "@/lib/username";

export async function updateProfile(formData: FormData) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Defense in depth — middleware already gates /account, but every
  // Server Action re-checks independently, same discipline
  // requireAdminSupabase() established for the founder admin surface.
  if (!user) redirect("/login");

  const displayNameRaw = String(formData.get("display_name") ?? "").trim();

  // User Identity + Follow Foundation pass — username is the one field
  // that actually gates a public identity (profiles_select_public RLS),
  // so it gets real validation before ever reaching the DB — the CHECK
  // constraint/unique index are the hard backstop, not the primary UX.
  // Blank means "no opinion, leave whatever's already saved" (an existing
  // username is never accidentally cleared by leaving the field as-is);
  // choosing a username is optional per this pass's own "no signup
  // blocker" requirement, so there is no required-field error here for
  // leaving it blank.
  const usernameRaw = String(formData.get("username") ?? "").trim();
  let username: string | null | undefined; // undefined = don't touch
  if (usernameRaw) {
    const validation = validateUsername(usernameRaw);
    if (!validation.ok) {
      redirect(`/account/profile?error=${encodeURIComponent(validation.error ?? "Invalid username.")}`);
    }
    username = validation.value;
  }

  const bioRaw = String(formData.get("bio") ?? "").trim();
  if (bioRaw.length > 280) {
    redirect(`/account/profile?error=${encodeURIComponent("Bio must be 280 characters or fewer.")}`);
  }

  const locationRaw = String(formData.get("location_label") ?? "").trim();
  if (locationRaw.length > 80) {
    redirect(`/account/profile?error=${encodeURIComponent("Location must be 80 characters or fewer.")}`);
  }

  const patch: Record<string, unknown> = {
    display_name: displayNameRaw || null,
    bio: bioRaw || null,
    location_label: locationRaw || null,
  };
  // avatar_url is intentionally not part of this form — the field is
  // hidden from the UI for now (no upload flow yet), so this update must
  // not touch it, or every save would silently null out any existing
  // value. Same reasoning is why `username` is only added to the patch
  // when the visitor actually typed one above.
  if (username !== undefined) patch.username = username;

  const { error } = await supabase.from("profiles").update(patch).eq("id", user.id);

  if (error) {
    // 23505 = unique_violation — profiles_username_unique_idx caught a
    // case-insensitive collision with someone else's username. Never
    // leak the raw Postgres error text (could hint at internals); a
    // plain "not available" reads exactly like the reserved-name case.
    const message = error.code === "23505" ? "That username is already taken." : error.message;
    redirect(`/account/profile?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/account/profile");
  redirect("/account/profile?saved=1");
}

export async function signOut() {
  const supabase = await getServerSupabase();
  await supabase.auth.signOut();
  redirect("/");
}
