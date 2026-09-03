"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { errorRedirectUrl, str } from "@/lib/admin/form-helpers";

const PAGE_KEY = "global";
const SECTION_KEY = "contact";
const EDIT_PATH = "/admin/site/contact";

/** Saves the site-wide public contact email/phone the mobile drawer's
 * utility strip reads (see lib/contact-info.ts) — one more site_sections
 * row (page_key "global", section_key "contact"), config_json
 * {email, phone}, the exact same generic upsert-by-(page_key,section_key)
 * mechanism every other Site Editor field already uses (see
 * ../homepage/actions.ts's saveWeatherConfig for the closest precedent).
 * No schema change: config_json already stores arbitrary per-section
 * JSON. Either field left blank is saved as blank (not defaulted to
 * anything) — the public reader treats blank as "not configured" and
 * hides that action rather than showing a dead link. */
export async function saveContactInfo(formData: FormData) {
  const supabase = await requireAdminSupabase();

  const email = str(formData, "email") ?? "";
  const phone = str(formData, "phone") ?? "";

  const { error } = await supabase.from("site_sections").upsert(
    {
      page_key: PAGE_KEY,
      section_key: SECTION_KEY,
      is_visible: true,
      config_json: { email, phone },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "page_key,section_key" }
  );
  if (error) redirect(errorRedirectUrl(EDIT_PATH, error.message));

  // Contact info shows on every public page (mobile drawer utility
  // strip), so the whole public tree needs revalidating, not just one
  // page path — layout.tsx is where it's actually read.
  revalidatePath("/", "layout");
  revalidatePath(EDIT_PATH);
  redirect(`${EDIT_PATH}?saved=1`);
}
