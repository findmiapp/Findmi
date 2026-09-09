"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { errorRedirectUrl, str, bool } from "@/lib/admin/form-helpers";

const PAGE_KEY = "about";
const EDIT_PATH = "/admin/site/about";

/** Saves the About page's "hero" section — heading/intro/highlight/body
 * paragraphs/both CTAs — the same generic upsert-by-(page_key,section_key)
 * pattern every other Site Editor field uses (see ../contact/actions.ts).
 * No schema change: site_sections already stores this shape. bodyExtra
 * and the secondary CTA fields live in config_json since SiteSection has
 * only one body/cta_label/cta_url column and this section needs two of
 * each — config_json already stores arbitrary per-section JSON for other
 * sections' image slots, so this isn't a new pattern. */
export async function saveAboutHero(formData: FormData) {
  const supabase = await requireAdminSupabase();

  const eyebrow = str(formData, "eyebrow");
  const heading = str(formData, "heading");
  const intro = str(formData, "intro");
  const highlight = str(formData, "highlight") ?? "";
  const bodyExtra = str(formData, "body_extra") ?? "";
  const ctaLabel = str(formData, "cta_label");
  const ctaUrl = str(formData, "cta_url");
  const secondaryCtaLabel = str(formData, "secondary_cta_label") ?? "";
  const secondaryCtaUrl = str(formData, "secondary_cta_url") ?? "";

  const { error } = await supabase.from("site_sections").upsert(
    {
      page_key: PAGE_KEY,
      section_key: "hero",
      eyebrow,
      heading,
      body: intro,
      cta_label: ctaLabel,
      cta_url: ctaUrl,
      is_visible: true,
      config_json: { highlight, bodyExtra, secondaryCtaLabel, secondaryCtaUrl },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "page_key,section_key" }
  );
  if (error) redirect(errorRedirectUrl(EDIT_PATH, error.message));

  revalidatePath("/about");
  revalidatePath(EDIT_PATH);
  redirect(`${EDIT_PATH}?saved=1`);
}

/** Saves the About page's Contact section — heading/copy/action label and
 * enabled/disabled (reusing is_visible rather than a new boolean). The
 * actual email destination is never saved here — see
 * lib/about-page.ts's resolveAboutContact and ../contact/actions.ts's
 * saveContactInfo, the one place that configures the real address. */
export async function saveAboutContact(formData: FormData) {
  const supabase = await requireAdminSupabase();

  const heading = str(formData, "contact_heading");
  const body = str(formData, "contact_body");
  const ctaLabel = str(formData, "contact_cta_label");
  const visible = bool(formData, "contact_visible");

  const { error } = await supabase.from("site_sections").upsert(
    {
      page_key: PAGE_KEY,
      section_key: "contact",
      heading,
      body,
      cta_label: ctaLabel,
      is_visible: visible,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "page_key,section_key" }
  );
  if (error) redirect(errorRedirectUrl(EDIT_PATH, error.message));

  revalidatePath("/about");
  revalidatePath(EDIT_PATH);
  redirect(`${EDIT_PATH}?saved=1`);
}
