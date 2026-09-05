"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { bool, str } from "@/lib/admin/form-helpers";
import { JOIN_CARD_KEYS, type JoinCardKey } from "@/lib/join-page";

const PAGE_KEY = "join";
const BASE_PATH = "/admin/site/join";
const PUBLIC_PATH = "/join";

// Every section below belongs to exactly one admin tab (see page.tsx's
// TABS) — the redirect after saving must land back on that same tab, not
// reset to the first one, same convention as /admin/businesses/[id]'s own
// per-tab editPath constants.
const TAB_PATHS = {
  hero: `${BASE_PATH}?tab=hero`,
  free: `${BASE_PATH}?tab=free`,
  pro: `${BASE_PATH}?tab=pro`,
  invite: `${BASE_PATH}?tab=invite`,
  additional: `${BASE_PATH}?tab=additional`,
  final: `${BASE_PATH}?tab=final`,
} as const;

// Every editPath here already carries its own "?tab=..." query string, so
// a bare errorRedirectUrl-style "base?key=value" would produce an invalid
// double "?" — same problem /admin/businesses/[id]'s tabbed actions solve
// with this exact helper (duplicated locally, not shared across files,
// matching that file's own precedent).
function appendQuery(base: string, params: Record<string, string>): string {
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${new URLSearchParams(params).toString()}`;
}

// Not exported itself, but every caller below IS an exported Server Action
// with no other check of its own — the auth check has to live here, the
// one place all of them funnel through.
async function upsertSection(sectionKey: string, payload: Record<string, unknown>, editPath: string) {
  const supabase = await requireAdminSupabase();

  const { error } = await supabase
    .from("site_sections")
    .upsert(
      { page_key: PAGE_KEY, section_key: sectionKey, updated_at: new Date().toISOString(), ...payload },
      { onConflict: "page_key,section_key" }
    );
  if (error) redirect(appendQuery(editPath, { error: error.message }));

  revalidatePath(BASE_PATH);
  revalidatePath(PUBLIC_PATH);
}

/** Admin Join Page Editor pass — config_json is one JSONB column shared by
 * every field that doesn't fit eyebrow/heading/body/cta_label/cta_url, and
 * more than one admin form can now target the SAME row's config_json (the
 * Pro card's main fields and its "extra presentation" fields both live on
 * card_discovery_pro). A plain `config_json: {...}` in an upsert REPLACES
 * the whole column, so without this, saving one form would silently wipe
 * whatever the other form's fields had stored — the exact "section save
 * overwrites unrelated content" failure this pass's own QA calls out.
 * Reads the row's current config_json first and merges the caller's own
 * patch on top of it — a `null` value in `patch` deletes that key (used
 * for the existing "blank field resets to default" convention), anything
 * else sets it; keys the caller doesn't mention are left completely alone. */
async function mergeConfigJson(sectionKey: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const supabase = await requireAdminSupabase();
  const { data } = await supabase
    .from("site_sections")
    .select("config_json")
    .eq("page_key", PAGE_KEY)
    .eq("section_key", sectionKey)
    .maybeSingle();
  const merged = { ...((data?.config_json ?? {}) as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

/** One per line, blank lines dropped — the shared feature-bullet-textarea
 * convention used by every list field on this page (card features, Free's
 * Included/Requires Pro columns). Returns null (not []) when the textarea
 * was left blank, so callers can tell "reset to default" apart from "an
 * explicit non-empty list" using the same null-deletes-the-key convention
 * mergeConfigJson relies on. */
function linesOrNull(formData: FormData, name: string): string[] | null {
  const raw = str(formData, name);
  if (!raw) return null;
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : null;
}

export async function saveJoinHero(formData: FormData) {
  await upsertSection(
    "hero",
    { heading: str(formData, "heading"), body: str(formData, "body") },
    TAB_PATHS.hero
  );
  redirect(appendQuery(TAB_PATHS.hero, { saved: "hero" }));
}

export async function saveJoinGlobal(formData: FormData) {
  await upsertSection(
    "global",
    {
      body: str(formData, "message"),
      cta_url: str(formData, "cta_url"),
      config_json: { supportingText: str(formData, "supporting_text") ?? "" },
    },
    TAB_PATHS.final
  );
  redirect(appendQuery(TAB_PATHS.final, { saved: "global" }));
}

export async function saveJoinCard(cardKey: JoinCardKey, formData: FormData) {
  const tabPath = cardKey === "card_discovery_pro" ? TAB_PATHS.pro : TAB_PATHS.additional;
  if (!JOIN_CARD_KEYS.includes(cardKey)) redirect(appendQuery(tabPath, { error: "Unknown card." }));

  const config_json = await mergeConfigJson(cardKey, {
    emphasis: bool(formData, "emphasis"),
    price: str(formData, "price"),
    priceSuffix: str(formData, "price_suffix"),
    features: linesOrNull(formData, "features"),
  });

  await upsertSection(
    cardKey,
    {
      eyebrow: str(formData, "eyebrow"),
      heading: str(formData, "title"),
      body: str(formData, "tagline"),
      cta_label: str(formData, "cta_label"),
      cta_url: str(formData, "cta_url"),
      is_visible: bool(formData, "is_visible"),
      config_json,
    },
    tabPath
  );
  redirect(appendQuery(tabPath, { saved: cardKey }));
}

/** Pro card's additional presentation fields (billing/supporting label,
 * the "no automatic renewal" note, the FindMi Here highlight block, the
 * price reassurance footnote) — same card_discovery_pro row/config_json
 * as saveJoinCard above, merged rather than replaced (see
 * mergeConfigJson) so saving this form never disturbs the price/
 * priceSuffix/emphasis/features the main Pro Plan form owns, and vice
 * versa. The Pro card's CTA label/eyebrow/title/tagline/features still go
 * through saveJoinCard("card_discovery_pro", ...) — this action only
 * covers the fields that don't fit that shared card shape. */
export async function saveJoinProExtra(formData: FormData) {
  const config_json = await mergeConfigJson("card_discovery_pro", {
    billingLabel: str(formData, "billing_label"),
    noRenewalNote: str(formData, "no_renewal_note"),
    highlightHeading: str(formData, "highlight_heading"),
    highlightSubheading: str(formData, "highlight_subheading"),
    highlightBody: str(formData, "highlight_body"),
    priceFootnote: str(formData, "price_footnote"),
  });
  await upsertSection("card_discovery_pro", { config_json }, TAB_PATHS.pro);
  redirect(appendQuery(TAB_PATHS.pro, { saved: "card_discovery_pro_extra" }));
}

export async function saveJoinFreeCard(formData: FormData) {
  const config_json = await mergeConfigJson("card_free", {
    price: str(formData, "price"),
    shortTagline: str(formData, "short_tagline"),
    disclosureLabel: str(formData, "disclosure_label"),
    includedFeatures: linesOrNull(formData, "included_features"),
    requiresProFeatures: linesOrNull(formData, "requires_pro_features"),
  });
  await upsertSection(
    "card_free",
    {
      heading: str(formData, "title"),
      body: str(formData, "description"),
      cta_label: str(formData, "cta_label"),
      is_visible: bool(formData, "is_visible"),
      config_json,
    },
    TAB_PATHS.free
  );
  redirect(appendQuery(TAB_PATHS.free, { saved: "card_free" }));
}

export async function saveJoinInviteSection(formData: FormData) {
  await upsertSection(
    "invite_section",
    {
      heading: str(formData, "heading"),
      body: str(formData, "helper_text"),
      is_visible: bool(formData, "is_visible"),
    },
    TAB_PATHS.invite
  );
  redirect(appendQuery(TAB_PATHS.invite, { saved: "invite_section" }));
}

export async function saveJoinClaimBusiness(formData: FormData) {
  await upsertSection(
    "claim_business",
    {
      body: str(formData, "body"),
      cta_label: str(formData, "cta_label"),
      cta_url: str(formData, "cta_url"),
      is_visible: bool(formData, "is_visible"),
    },
    TAB_PATHS.additional
  );
  redirect(appendQuery(TAB_PATHS.additional, { saved: "claim_business" }));
}

export async function saveJoinReassurance(formData: FormData) {
  await upsertSection(
    "reassurance_top",
    { body: str(formData, "text"), is_visible: bool(formData, "is_visible") },
    TAB_PATHS.additional
  );
  redirect(appendQuery(TAB_PATHS.additional, { saved: "reassurance_top" }));
}

export async function saveJoinMoreWays(formData: FormData) {
  await upsertSection("more_ways", { heading: str(formData, "heading") }, TAB_PATHS.additional);
  redirect(appendQuery(TAB_PATHS.additional, { saved: "more_ways" }));
}

export async function saveJoinWhatYouGet(formData: FormData) {
  await upsertSection(
    "what_you_get",
    {
      eyebrow: str(formData, "eyebrow"),
      heading: str(formData, "heading"),
      body: str(formData, "body"),
      cta_label: str(formData, "cta_label"),
      cta_url: str(formData, "cta_url"),
      is_visible: bool(formData, "is_visible"),
    },
    TAB_PATHS.final
  );
  redirect(appendQuery(TAB_PATHS.final, { saved: "what_you_get" }));
}

/** The four "Show the product" preview tiles — same what_you_get row as
 * saveJoinWhatYouGet above, but that action never touches config_json (no
 * config_json key in its own payload), so there's no clobber risk between
 * the two forms even without merging. Still uses mergeConfigJson for
 * consistency/future-proofing. */
export async function saveJoinWhatYouGetTiles(formData: FormData) {
  const tiles = [1, 2, 3, 4].map((i) => ({
    label: str(formData, `tile_${i}_label`) ?? "",
    detail: str(formData, `tile_${i}_detail`) ?? "",
  }));
  const anyContent = tiles.some((t) => t.label || t.detail);

  const config_json = await mergeConfigJson("what_you_get", {
    tiles: anyContent ? tiles : null,
  });
  await upsertSection("what_you_get", { config_json }, TAB_PATHS.final);
  redirect(appendQuery(TAB_PATHS.final, { saved: "what_you_get_tiles" }));
}
