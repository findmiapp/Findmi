"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";

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
  const avatarUrlRaw = String(formData.get("avatar_url") ?? "").trim();

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: displayNameRaw || null,
      avatar_url: avatarUrlRaw || null,
    })
    .eq("id", user.id);

  if (error) {
    redirect(`/account?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/account");
  redirect("/account?saved=1");
}

export async function signOut() {
  const supabase = await getServerSupabase();
  await supabase.auth.signOut();
  redirect("/");
}
