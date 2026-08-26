"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { bool, errorRedirectUrl, num, str } from "@/lib/admin/form-helpers";
import { validateCustomDestination } from "@/lib/navigation";
import {
  DEFAULT_DISCOVERY_TOPICS,
  DEFAULT_WEATHER_CITY,
  HOMEPAGE_ORDERABLE_KEYS,
  HOMEPAGE_SECTIONS,
  resolveSection,
  type DiscoveryTopic,
} from "@/lib/site-sections";
import type { SiteSection } from "@/lib/types";

const PAGE_KEY = "homepage";
const EDIT_PATH = "/admin/site/homepage";

export async function saveSiteSection(sectionKey: string, formData: FormData) {
  const supabase = getAdminSupabase();
  if (!supabase) redirect(errorRedirectUrl(EDIT_PATH, "Server isn't configured for writes."));

  const def = HOMEPAGE_SECTIONS[sectionKey];
  if (!def) redirect(errorRedirectUrl(EDIT_PATH, "Unknown section."));

  // Preserve the existing sort_order (set by Move Up/Down, or the
  // section's registry default) — this form never touches ordering, so an
  // upsert must not silently reset it to the table's own default of 0.
  const { data: existing } = await supabase
    .from("site_sections")
    .select("sort_order")
    .eq("page_key", PAGE_KEY)
    .eq("section_key", sectionKey)
    .maybeSingle();

  const payload: Record<string, unknown> = {
    page_key: PAGE_KEY,
    section_key: sectionKey,
    eyebrow: str(formData, "eyebrow"),
    heading: str(formData, "heading"),
    body: str(formData, "body"),
    cta_label: str(formData, "cta_label"),
    cta_url: str(formData, "cta_url"),
    is_visible: bool(formData, "is_visible"),
    sort_order: existing?.sort_order ?? def.order,
    updated_at: new Date().toISOString(),
  };

  // Image slots (see SectionDefaults.imageSlots) save into config_json —
  // the site_sections column that's existed since this table's original
  // migration, not a new one. Omitted entirely for sections without
  // imageSlots, so upsert leaves any other section's config_json alone.
  if (def.imageSlots) {
    const images = Array.from({ length: def.imageSlots }, (_, i) => str(formData, `image_${i + 1}`)).filter(
      (url): url is string => Boolean(url)
    );
    payload.config_json = { images };
  }

  const { error } = await supabase
    .from("site_sections")
    .upsert(payload, { onConflict: "page_key,section_key" });
  if (error) redirect(errorRedirectUrl(EDIT_PATH, error.message));

  revalidatePath(EDIT_PATH);
  revalidatePath("/");
  redirect(`${EDIT_PATH}?saved=${sectionKey}`);
}

// Discovery Topics — fixed six slots (position-matched to
// DEFAULT_DISCOVERY_TOPICS), each independently editable: label,
// destination, visible, and display order. No add/remove — the task this
// shipped for only asked for editing the initial six without a code
// change, not a general repeater. An invalid or blank URL is saved as
// empty rather than a broken link — resolveDiscoveryTopics() already
// hides any topic with no URL, so that topic just won't render until a
// real destination is entered.
export async function saveDiscoveryTopics(formData: FormData) {
  const supabase = getAdminSupabase();
  if (!supabase) redirect(errorRedirectUrl(EDIT_PATH, "Server isn't configured for writes."));

  const topics: DiscoveryTopic[] = DEFAULT_DISCOVERY_TOPICS.map((def, i) => {
    const n = i + 1;
    const label = str(formData, `topic_${n}_label`) ?? def.label;
    const rawUrl = str(formData, `topic_${n}_url`);
    const visible = bool(formData, `topic_${n}_visible`);
    const order = num(formData, `topic_${n}_order`) ?? def.order;

    let url = "";
    if (rawUrl) {
      const check = validateCustomDestination(rawUrl);
      if (check.ok) url = check.value;
      // Invalid input is silently dropped rather than failing the whole
      // form — same "no dead links" outcome as leaving it blank.
    }

    return { label, url, visible, order };
  });

  const { data: existing } = await supabase
    .from("site_sections")
    .select("sort_order")
    .eq("page_key", PAGE_KEY)
    .eq("section_key", "discovery_topics")
    .maybeSingle();

  const { error } = await supabase.from("site_sections").upsert(
    {
      page_key: PAGE_KEY,
      section_key: "discovery_topics",
      is_visible: true,
      sort_order: existing?.sort_order ?? 5,
      config_json: { topics },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "page_key,section_key" }
  );
  if (error) redirect(errorRedirectUrl(EDIT_PATH, error.message));

  revalidatePath(EDIT_PATH);
  revalidatePath("/");
  redirect(`${EDIT_PATH}?saved=discovery_topics`);
}

// Weather / Local Context — two founder-facing fields only (Section 8:
// "Do not expose API internals"). "Show weather" reuses the existing
// is_visible column rather than a second config flag; the city string is
// resolved server-side by lib/weather.ts (geocoded, current conditions
// fetched) — nothing here talks to the weather provider directly.
export async function saveWeatherConfig(formData: FormData) {
  const supabase = getAdminSupabase();
  if (!supabase) redirect(errorRedirectUrl(EDIT_PATH, "Server isn't configured for writes."));

  const city = str(formData, "weather_city") ?? DEFAULT_WEATHER_CITY;
  const show = bool(formData, "weather_show");

  const { error } = await supabase.from("site_sections").upsert(
    {
      page_key: PAGE_KEY,
      section_key: "weather",
      is_visible: show,
      config_json: { city },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "page_key,section_key" }
  );
  if (error) redirect(errorRedirectUrl(EDIT_PATH, error.message));

  revalidatePath(EDIT_PATH);
  revalidatePath("/");
  redirect(`${EDIT_PATH}?saved=weather`);
}

async function ensureSectionRow(
  supabase: NonNullable<ReturnType<typeof getAdminSupabase>>,
  sectionKey: string
): Promise<SiteSection> {
  const { data: existing } = await supabase
    .from("site_sections")
    .select("*")
    .eq("page_key", PAGE_KEY)
    .eq("section_key", sectionKey)
    .maybeSingle();
  if (existing) return existing as SiteSection;

  const def = HOMEPAGE_SECTIONS[sectionKey];
  const { data: created } = await supabase
    .from("site_sections")
    .insert({ page_key: PAGE_KEY, section_key: sectionKey, sort_order: def?.order ?? 0 })
    .select("*")
    .single();
  return created as SiteSection;
}

async function moveSection(sectionKey: string, direction: "up" | "down") {
  const supabase = getAdminSupabase();
  if (!supabase) redirect(errorRedirectUrl(EDIT_PATH, "Server isn't configured for writes."));

  const { data } = await supabase.from("site_sections").select("*").eq("page_key", PAGE_KEY);
  const overrides = new Map<string, SiteSection>();
  for (const row of (data ?? []) as SiteSection[]) overrides.set(row.section_key, row);

  const ordered = HOMEPAGE_ORDERABLE_KEYS.map((key) => ({
    key,
    order: resolveSection(overrides, key, HOMEPAGE_SECTIONS[key]).order,
  })).sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));

  const index = ordered.findIndex((s) => s.key === sectionKey);
  const neighborIndex = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || neighborIndex < 0 || neighborIndex >= ordered.length) {
    redirect(EDIT_PATH); // already at the top/bottom — nothing to do
  }

  const current = await ensureSectionRow(supabase, sectionKey);
  const neighbor = await ensureSectionRow(supabase, ordered[neighborIndex].key);

  await supabase.from("site_sections").update({ sort_order: neighbor.sort_order }).eq("id", current.id);
  await supabase.from("site_sections").update({ sort_order: current.sort_order }).eq("id", neighbor.id);

  revalidatePath(EDIT_PATH);
  revalidatePath("/");
  redirect(EDIT_PATH);
}

export async function moveSectionUp(sectionKey: string) {
  await moveSection(sectionKey, "up");
}

export async function moveSectionDown(sectionKey: string) {
  await moveSection(sectionKey, "down");
}
