"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { bool, errorRedirectUrl, str } from "@/lib/admin/form-helpers";
import { JOIN_CARD_KEYS, type JoinCardKey } from "@/lib/join-page";

const PAGE_KEY = "join";
const EDIT_PATH = "/admin/site/join";
const PUBLIC_PATH = "/join";

// Not exported itself, but every caller below (saveJoinHero, saveJoinGlobal,
// saveJoinCard, saveJoinWhatYouGet) IS an exported Server Action with no
// other check of its own — the auth check has to live here, the one place
// all four funnel through.
async function upsertSection(sectionKey: string, payload: Record<string, unknown>) {
  const supabase = await requireAdminSupabase();

  const { error } = await supabase
    .from("site_sections")
    .upsert(
      { page_key: PAGE_KEY, section_key: sectionKey, updated_at: new Date().toISOString(), ...payload },
      { onConflict: "page_key,section_key" }
    );
  if (error) redirect(errorRedirectUrl(EDIT_PATH, error.message));

  revalidatePath(EDIT_PATH);
  revalidatePath(PUBLIC_PATH);
}

export async function saveJoinHero(formData: FormData) {
  await upsertSection("hero", {
    heading: str(formData, "heading"),
    body: str(formData, "body"),
  });
  redirect(`${EDIT_PATH}?saved=hero`);
}

export async function saveJoinGlobal(formData: FormData) {
  await upsertSection("global", {
    body: str(formData, "message"),
    cta_url: str(formData, "cta_url"),
    config_json: { supportingText: str(formData, "supporting_text") ?? "" },
  });
  redirect(`${EDIT_PATH}?saved=global`);
}

export async function saveJoinCard(cardKey: JoinCardKey, formData: FormData) {
  if (!JOIN_CARD_KEYS.includes(cardKey)) redirect(errorRedirectUrl(EDIT_PATH, "Unknown card."));

  // Feature bullets: one per line, blank lines dropped. An empty textarea
  // (nothing typed) falls back to this card's default feature list — same
  // "blank keeps the current default" convention as every text field here
  // — rather than saving/rendering a card with zero bullets.
  const featuresRaw = str(formData, "features");
  const features = featuresRaw
    ? featuresRaw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    : [];

  const config: Record<string, unknown> = { emphasis: bool(formData, "emphasis") };
  const price = str(formData, "price");
  if (price) config.price = price;
  const priceSuffix = str(formData, "price_suffix");
  if (priceSuffix) config.priceSuffix = priceSuffix;
  if (features.length > 0) config.features = features;

  await upsertSection(cardKey, {
    eyebrow: str(formData, "eyebrow"),
    heading: str(formData, "title"),
    body: str(formData, "tagline"),
    cta_label: str(formData, "cta_label"),
    cta_url: str(formData, "cta_url"),
    is_visible: bool(formData, "is_visible"),
    config_json: config,
  });
  redirect(`${EDIT_PATH}?saved=${cardKey}`);
}

export async function saveJoinWhatYouGet(formData: FormData) {
  await upsertSection("what_you_get", {
    eyebrow: str(formData, "eyebrow"),
    heading: str(formData, "heading"),
    body: str(formData, "body"),
    cta_label: str(formData, "cta_label"),
    cta_url: str(formData, "cta_url"),
    is_visible: bool(formData, "is_visible"),
  });
  redirect(`${EDIT_PATH}?saved=what_you_get`);
}
