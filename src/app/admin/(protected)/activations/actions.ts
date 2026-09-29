"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { isSlugTaken } from "@/lib/admin/queries";
import { bool, errorRedirectUrl, num, str } from "@/lib/admin/form-helpers";
import { ensureUniqueSlug, resolveSlugInput } from "@/lib/slug";
import { localDateTimeToIso } from "@/lib/admin/form-helpers";
import { reorderActivationRows } from "@/lib/admin/activations";
import type {
  ActivationInventoryKind,
  ActivationInventoryPriceType,
  ActivationOptionKind,
  ActivationPhase,
  ActivationPriceVisibility,
  ActivationVenueStatus,
} from "@/lib/admin/activations";

const PHASES: ActivationPhase[] = ["draft", "exploring", "applications_open", "confirmed", "live", "completed", "archived"];
const PRICE_VISIBILITIES: ActivationPriceVisibility[] = ["visible", "hidden", "custom_label"];
const VENUE_STATUSES: ActivationVenueStatus[] = ["planned", "confirmed", "cancelled"];
const PRICE_TYPES: ActivationInventoryPriceType[] = ["fixed", "starting_at", "custom", "included", "free"];

function revalidateActivation(id: string) {
  revalidatePath("/admin/activations");
  revalidatePath(`/admin/activations/${id}`);
}

// ── ACTIVATIONS ─────────────────────────────────────────────────────────

export async function createActivation(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const createPath = "/admin/activations/new";

  const internalName = str(formData, "internal_name");
  const publicName = str(formData, "public_name");
  if (!internalName) redirect(errorRedirectUrl(createPath, "Internal name is required."));
  if (!publicName) redirect(errorRedirectUrl(createPath, "Public name is required."));

  const baseSlug = resolveSlugInput(str(formData, "slug"), publicName);
  if (!baseSlug) redirect(errorRedirectUrl(createPath, "Public name is required to generate a slug."));
  const slug = await ensureUniqueSlug(baseSlug, (candidate) => isSlugTaken("activations", candidate));

  const { data, error } = await supabase
    .from("activations")
    .insert({
      internal_name: internalName,
      public_name: publicName,
      slug,
      concept_label: str(formData, "concept_label"),
      city: str(formData, "city"),
      region: str(formData, "region"),
      country_code: str(formData, "country_code"),
      default_timezone: str(formData, "default_timezone") ?? "America/New_York",
      currency_code: str(formData, "currency_code") ?? "USD",
    })
    .select("id")
    .single();
  if (error || !data) redirect(errorRedirectUrl(createPath, error?.message ?? "Could not create Activation."));

  revalidatePath("/admin/activations");
  redirect(`/admin/activations/${data.id}?saved=1`);
}

export async function saveActivationOverview(id: string, formData: FormData) {
  const supabase = await requireAdminSupabase();
  const editPath = `/admin/activations/${id}?tab=overview`;

  const phaseRaw = str(formData, "phase");
  const phase = phaseRaw && PHASES.includes(phaseRaw as ActivationPhase) ? (phaseRaw as ActivationPhase) : "draft";

  const { error } = await supabase
    .from("activations")
    .update({
      phase,
      target_revenue: num(formData, "target_revenue"),
      minimum_committed_threshold: num(formData, "minimum_committed_threshold"),
      target_brand_count: num(formData, "target_brand_count"),
      anchor_partner_target: num(formData, "anchor_partner_target"),
      venue_budget_ceiling: num(formData, "venue_budget_ceiling"),
      production_budget_ceiling: num(formData, "production_budget_ceiling"),
      decision_deadline: str(formData, "decision_deadline"),
    })
    .eq("id", id);
  if (error) redirect(errorRedirectUrl(editPath, error.message));

  revalidateActivation(id);
  redirect(`/admin/activations/${id}?tab=overview&saved=1`);
}

export async function saveActivationSettings(id: string, formData: FormData) {
  const supabase = await requireAdminSupabase();
  const editPath = `/admin/activations/${id}?tab=settings`;

  const baseSlug = resolveSlugInput(str(formData, "slug"), null);
  if (!baseSlug) redirect(errorRedirectUrl(editPath, "Slug is required."));
  const slug = await ensureUniqueSlug(baseSlug, (candidate) => isSlugTaken("activations", candidate, id));

  const priceVisRaw = str(formData, "default_price_visibility");
  const defaultPriceVisibility: ActivationPriceVisibility =
    priceVisRaw && PRICE_VISIBILITIES.includes(priceVisRaw as ActivationPriceVisibility)
      ? (priceVisRaw as ActivationPriceVisibility)
      : "visible";

  const { error } = await supabase
    .from("activations")
    .update({
      slug,
      city: str(formData, "city"),
      region: str(formData, "region"),
      country_code: str(formData, "country_code"),
      default_timezone: str(formData, "default_timezone") ?? "America/New_York",
      currency_code: str(formData, "currency_code") ?? "USD",
      default_price_visibility: defaultPriceVisibility,
      is_published: bool(formData, "is_published"),
      publish_at: str(formData, "publish_at"),
    })
    .eq("id", id);
  if (error) redirect(errorRedirectUrl(editPath, error.message));

  revalidateActivation(id);
  redirect(`/admin/activations/${id}?tab=settings&saved=1`);
}

export async function saveActivationPublicPage(id: string, formData: FormData) {
  const supabase = await requireAdminSupabase();
  const editPath = `/admin/activations/${id}?tab=public-page`;

  const publicName = str(formData, "public_name");
  if (!publicName) redirect(errorRedirectUrl(editPath, "Public name is required."));

  const { error } = await supabase
    .from("activations")
    .update({
      public_name: publicName,
      concept_label: str(formData, "concept_label"),
      short_description: str(formData, "short_description"),
      description: str(formData, "description"),
      cover_image_url: str(formData, "cover_image_url"),
      meta_title: str(formData, "meta_title"),
      meta_description: str(formData, "meta_description"),
      og_image_url: str(formData, "og_image_url"),
    })
    .eq("id", id);
  if (error) redirect(errorRedirectUrl(editPath, error.message));

  revalidateActivation(id);
  redirect(`/admin/activations/${id}?tab=public-page&saved=1`);
}

export async function deleteActivation(id: string) {
  const supabase = await requireAdminSupabase();
  await supabase.from("activations").delete().eq("id", id);
  revalidatePath("/admin/activations");
  redirect("/admin/activations");
}

// ── VENUES ───────────────────────────────────────────────────────────────

export async function createActivationVenue(activationId: string, formData: FormData) {
  const supabase = await requireAdminSupabase();
  const editPath = `/admin/activations/${activationId}?tab=venues`;

  const name = str(formData, "name");
  const { error } = await supabase.from("activation_venues").insert({
    activation_id: activationId,
    name: name ?? "New venue",
  });
  if (error) redirect(errorRedirectUrl(editPath, error.message));

  revalidateActivation(activationId);
  redirect(`/admin/activations/${activationId}?tab=venues&saved=1`);
}

export async function saveActivationVenue(activationId: string, id: string, formData: FormData) {
  const supabase = await requireAdminSupabase();
  const editPath = `/admin/activations/${activationId}?tab=venues`;

  const statusRaw = str(formData, "status");
  const status = statusRaw && VENUE_STATUSES.includes(statusRaw as ActivationVenueStatus) ? (statusRaw as ActivationVenueStatus) : "planned";

  // datetime-local inputs post "YYYY-MM-DDTHH:mm" with no timezone context
  // — treated as being in this same form's own submitted `timezone` field
  // (falling back to America/New_York, matching localDateTimeToIso's own
  // default), same convention event_occurrences editing already uses.
  const timezone = str(formData, "timezone") ?? undefined;

  const { error } = await supabase
    .from("activation_venues")
    .update({
      name: str(formData, "name"),
      location_id: str(formData, "location_id"),
      city: str(formData, "city"),
      region: str(formData, "region"),
      country_code: str(formData, "country_code"),
      timezone: str(formData, "timezone"),
      start_at: localDateTimeToIso(str(formData, "start_at"), timezone),
      end_at: localDateTimeToIso(str(formData, "end_at"), timezone),
      is_primary: bool(formData, "is_primary"),
      status,
    })
    .eq("id", id);
  if (error) redirect(errorRedirectUrl(editPath, error.message));

  revalidateActivation(activationId);
  redirect(`/admin/activations/${activationId}?tab=venues&saved=1`);
}

export async function deleteActivationVenue(activationId: string, id: string) {
  const supabase = await requireAdminSupabase();
  await supabase.from("activation_venues").delete().eq("id", id);
  revalidateActivation(activationId);
  redirect(`/admin/activations/${activationId}?tab=venues`);
}

// ── OPTIONS (Goals / Activation Families) ───────────────────────────────

export async function createActivationOption(activationId: string, kind: ActivationOptionKind, formData: FormData) {
  const supabase = await requireAdminSupabase();
  const editPath = `/admin/activations/${activationId}?tab=builder-config`;

  const label = str(formData, "label");
  if (!label) redirect(errorRedirectUrl(editPath, "Label is required."));

  const { error } = await supabase.from("activation_options").insert({
    activation_id: activationId,
    kind,
    label,
  });
  if (error) redirect(errorRedirectUrl(editPath, error.message));

  revalidateActivation(activationId);
  redirect(`/admin/activations/${activationId}?tab=builder-config&saved=1`);
}

export async function saveActivationOption(activationId: string, id: string, formData: FormData) {
  const supabase = await requireAdminSupabase();
  const editPath = `/admin/activations/${activationId}?tab=builder-config`;

  const label = str(formData, "label");
  if (!label) redirect(errorRedirectUrl(editPath, "Label is required."));

  const { error } = await supabase
    .from("activation_options")
    .update({
      label,
      description: str(formData, "description"),
      icon_or_image_url: str(formData, "icon_or_image_url"),
      is_active: bool(formData, "is_active"),
    })
    .eq("id", id);
  if (error) redirect(errorRedirectUrl(editPath, error.message));

  revalidateActivation(activationId);
  redirect(`/admin/activations/${activationId}?tab=builder-config&saved=1`);
}

export async function deleteActivationOption(activationId: string, id: string) {
  const supabase = await requireAdminSupabase();
  await supabase.from("activation_options").delete().eq("id", id);
  revalidateActivation(activationId);
  redirect(`/admin/activations/${activationId}?tab=builder-config`);
}

export async function moveActivationOption(activationId: string, kind: ActivationOptionKind, id: string, direction: "up" | "down") {
  const supabase = await requireAdminSupabase();
  await reorderActivationRows(supabase, "activation_options", { activation_id: activationId, kind }, id, direction);
  revalidateActivation(activationId);
  redirect(`/admin/activations/${activationId}?tab=builder-config`);
}

// ── INVENTORY (Space / Timing / Add-ons) ────────────────────────────────

export async function createActivationInventoryItem(activationId: string, kind: ActivationInventoryKind, formData: FormData) {
  const supabase = await requireAdminSupabase();
  const editPath = `/admin/activations/${activationId}?tab=builder-config`;

  const name = str(formData, "name");
  if (!name) redirect(errorRedirectUrl(editPath, "Name is required."));

  const { error } = await supabase.from("activation_inventory").insert({
    activation_id: activationId,
    kind,
    name,
  });
  if (error) redirect(errorRedirectUrl(editPath, error.message));

  revalidateActivation(activationId);
  redirect(`/admin/activations/${activationId}?tab=builder-config&saved=1`);
}

export async function saveActivationInventoryItem(activationId: string, id: string, formData: FormData) {
  const supabase = await requireAdminSupabase();
  const editPath = `/admin/activations/${activationId}?tab=builder-config`;

  const name = str(formData, "name");
  if (!name) redirect(errorRedirectUrl(editPath, "Name is required."));

  const priceTypeRaw = str(formData, "price_type");
  const priceType = priceTypeRaw && PRICE_TYPES.includes(priceTypeRaw as ActivationInventoryPriceType) ? (priceTypeRaw as ActivationInventoryPriceType) : "fixed";

  // null = inherit the Activation's own default_price_visibility (Amendment
  // §5's corrected model) — the "Inherit default" <option value=""> posts
  // an empty string, which `str()` already normalizes to null.
  const priceVisRaw = str(formData, "price_visibility");
  const priceVisibility =
    priceVisRaw && PRICE_VISIBILITIES.includes(priceVisRaw as ActivationPriceVisibility) ? (priceVisRaw as ActivationPriceVisibility) : null;

  const categoryIds = formData.getAll("relevant_category_ids").filter((v): v is string => typeof v === "string" && v.length > 0);

  const { error } = await supabase
    .from("activation_inventory")
    .update({
      name,
      description: str(formData, "description"),
      image_url: str(formData, "image_url"),
      venue_id: str(formData, "venue_id"),
      capacity: num(formData, "capacity"),
      price_type: priceType,
      price_amount: num(formData, "price_amount"),
      price_label: str(formData, "price_label"),
      internal_estimated_value: num(formData, "internal_estimated_value"),
      price_visibility: priceVisibility,
      relevant_category_ids: categoryIds.length > 0 ? categoryIds : null,
      requirements: str(formData, "requirements"),
      is_active: bool(formData, "is_active"),
    })
    .eq("id", id);
  if (error) redirect(errorRedirectUrl(editPath, error.message));

  revalidateActivation(activationId);
  redirect(`/admin/activations/${activationId}?tab=builder-config&saved=1`);
}

export async function deleteActivationInventoryItem(activationId: string, id: string) {
  const supabase = await requireAdminSupabase();
  await supabase.from("activation_inventory").delete().eq("id", id);
  revalidateActivation(activationId);
  redirect(`/admin/activations/${activationId}?tab=builder-config`);
}

export async function moveActivationInventoryItem(
  activationId: string,
  kind: ActivationInventoryKind,
  id: string,
  direction: "up" | "down"
) {
  const supabase = await requireAdminSupabase();
  await reorderActivationRows(supabase, "activation_inventory", { activation_id: activationId, kind }, id, direction);
  revalidateActivation(activationId);
  redirect(`/admin/activations/${activationId}?tab=builder-config`);
}
