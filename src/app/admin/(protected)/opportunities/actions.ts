"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { bool, localDateTimeToIso, str } from "@/lib/admin/form-helpers";
import {
  buildAdminRecipientUpdate,
  canListingTransition,
  canManageRecipients,
  isListingStatus,
  isRecipientStatus,
  planRecipientSend,
  validateListingInput,
  type ListingFields,
  type ListingStatus,
  type RecipientStatus,
} from "@/lib/opportunity-listings-domain";

// Opportunities V1 Pass 2 — Admin writes for opportunity_listings /
// opportunity_recipients. Every action: requireAdmin() first, then the
// service-role client; every rule comes from the canonical domain module.
// Nothing here ever deletes a row, ever writes a Business response
// (responded_at / responded_by_user_id / response_note), or touches the
// Event participation `opportunities` table.

const LIST = "/admin/opportunities";
const detail = (id: string) => `${LIST}/${id}`;
const fail = (base: string, message: string): never => redirect(`${base}?error=${encodeURIComponent(message)}`);

function client(base: string) {
  const supabase = getAdminSupabase();
  if (!supabase) fail(base, "Storage isn't configured on the server.");
  return supabase!;
}

function readListingForm(formData: FormData) {
  return validateListingInput({
    opportunity_type: str(formData, "opportunity_type"),
    title: str(formData, "title"),
    summary: str(formData, "summary"),
    description: str(formData, "description"),
    image_url: str(formData, "image_url"),
    location_id: str(formData, "location_id"),
    place_text: str(formData, "place_text"),
    host_name: str(formData, "host_name"),
    event_id: str(formData, "event_id"),
    starts_at: localDateTimeToIso(str(formData, "starts_at")),
    ends_at: localDateTimeToIso(str(formData, "ends_at")),
    timing_note: str(formData, "timing_note"),
    response_deadline: localDateTimeToIso(str(formData, "response_deadline")),
    pricing_mode: str(formData, "pricing_mode"),
    price: str(formData, "price"),
    currency: str(formData, "currency"),
    credits_eligible: bool(formData, "credits_eligible"),
    whats_included: str(formData, "whats_included"),
    requirements: str(formData, "requirements"),
    internal_notes: str(formData, "internal_notes"),
  });
}

/** Referenced Location / Event must exist (a clear message instead of a
 * foreign-key error). */
async function checkReferences(supabase: NonNullable<ReturnType<typeof getAdminSupabase>>, fields: ListingFields): Promise<string | null> {
  const [location, event] = await Promise.all([
    fields.location_id ? supabase.from("locations").select("id").eq("id", fields.location_id).maybeSingle() : null,
    fields.event_id ? supabase.from("events").select("id").eq("id", fields.event_id).maybeSingle() : null,
  ]);
  if (fields.location_id && !location?.data) return "That Location no longer exists.";
  if (fields.event_id && !event?.data) return "That Event no longer exists.";
  return null;
}

function revalidateListing(id?: string) {
  revalidatePath(LIST);
  if (id) revalidatePath(detail(id));
}

/** Create — always starts as a Draft. */
export async function createOpportunity(formData: FormData) {
  await requireAdmin();
  const base = `${LIST}/new`;
  const parsed = readListingForm(formData);
  if (!parsed.ok) fail(base, parsed.error);
  const fields = (parsed as { ok: true; value: ListingFields }).value;
  const supabase = client(base);
  const refError = await checkReferences(supabase, fields);
  if (refError) fail(base, refError);

  const { data, error } = await supabase
    .from("opportunity_listings")
    .insert({ ...fields, status: "draft" })
    .select("id")
    .single();
  if (error || !data) fail(base, error?.message ?? "Couldn't create the Opportunity.");

  revalidateListing();
  redirect(`${detail(data!.id)}?saved=created`);
}

/** Edit — every field except status. */
export async function saveOpportunity(id: string, formData: FormData) {
  await requireAdmin();
  const base = detail(id);
  const parsed = readListingForm(formData);
  if (!parsed.ok) fail(base, parsed.error);
  const fields = (parsed as { ok: true; value: ListingFields }).value;
  const supabase = client(base);
  const refError = await checkReferences(supabase, fields);
  if (refError) fail(base, refError);

  const { data, error } = await supabase.from("opportunity_listings").update(fields).eq("id", id).select("id").maybeSingle();
  if (error || !data) fail(base, error?.message ?? "Opportunity not found.");

  revalidateListing(id);
  redirect(`${base}?saved=1`);
}

/** Open / Close / Reopen / Archive / Unarchive. Canonical transitions only,
 * written conditionally on the status it was read in. Archive is an update,
 * never a delete. */
export async function setOpportunityStatus(id: string, next: ListingStatus) {
  await requireAdmin();
  const base = detail(id);
  if (!isListingStatus(next)) fail(base, "Unknown status.");
  const supabase = client(base);
  const { data: row } = await supabase.from("opportunity_listings").select("status").eq("id", id).maybeSingle();
  if (!row) fail(base, "Opportunity not found.");
  const current = row!.status as ListingStatus;
  if (!canListingTransition(current, next)) fail(base, `A ${current} Opportunity can't move to ${next}.`);

  const { data, error } = await supabase
    .from("opportunity_listings")
    .update({ status: next })
    .eq("id", id)
    .eq("status", current)
    .select("id")
    .maybeSingle();
  if (error || !data) fail(base, error?.message ?? "This Opportunity changed while you were editing. Please try again.");

  revalidateListing(id);
  redirect(`${base}?saved=status-${next}`);
}

/** Send / recommend to Businesses. Rows are only created here (never while
 * searching or selecting). Already-sent Businesses are skipped and
 * reported; the unique (listing_id, business_id) key backs that up with
 * ignoreDuplicates so a concurrent double-send can't fail or duplicate. */
export async function sendOpportunity(id: string, formData: FormData) {
  await requireAdmin();
  const base = detail(id);
  const supabase = client(base);

  const businessIds = formData.getAll("business_id").filter((v): v is string => typeof v === "string");
  const fitNotes: Record<string, string> = {};
  for (const businessId of businessIds) {
    const note = formData.get(`fit_note_${businessId}`);
    if (typeof note === "string") fitNotes[businessId] = note;
  }

  const [{ data: listing }, { data: existing }, { data: businesses }] = await Promise.all([
    supabase.from("opportunity_listings").select("status").eq("id", id).maybeSingle(),
    supabase.from("opportunity_recipients").select("business_id").eq("listing_id", id),
    businessIds.length ? supabase.from("businesses").select("id, name").in("id", businessIds) : Promise.resolve({ data: [] }),
  ]);
  if (!listing) fail(base, "Opportunity not found.");

  // Only real Businesses can be sent to.
  const known = new Map(((businesses ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name]));
  const plan = planRecipientSend({
    listingId: id,
    listingStatus: listing!.status as ListingStatus,
    businessIds: businessIds.filter((b) => known.has(b)),
    existingBusinessIds: ((existing ?? []) as { business_id: string }[]).map((r) => r.business_id),
    fitNotes,
    now: new Date().toISOString(),
  });
  if (!plan.ok) fail(base, businessIds.length && known.size === 0 ? "Those Businesses no longer exist." : plan.error);
  const { rows, skippedBusinessIds } = plan as Extract<typeof plan, { ok: true }>;

  let sent = 0;
  if (rows.length) {
    const { data: inserted, error } = await supabase
      .from("opportunity_recipients")
      .upsert(rows, { onConflict: "listing_id,business_id", ignoreDuplicates: true })
      .select("business_id");
    if (error) fail(base, error.message);
    const insertedIds = new Set(((inserted ?? []) as { business_id: string }[]).map((r) => r.business_id));
    sent = insertedIds.size;
    // A row that lost a race to a concurrent send is a skip, not a failure.
    for (const r of rows) if (!insertedIds.has(r.business_id)) skippedBusinessIds.push(r.business_id);
  }

  revalidateListing(id);
  const params = new URLSearchParams({ saved: "sent", sent: String(sent) });
  if (skippedBusinessIds.length) params.set("skipped", skippedBusinessIds.map((b) => known.get(b) ?? "A Business").join(", "));
  redirect(`${base}?${params.toString()}#recipients`);
}

/** A Findmi-controlled recipient outcome (canonical ADMIN_TRANSITIONS).
 * Writes status + status_changed_at only — never a Business response. */
export async function setRecipientStatus(listingId: string, recipientId: string, next: RecipientStatus) {
  await requireAdmin();
  const base = detail(listingId);
  if (!isRecipientStatus(next)) fail(base, "Unknown status.");
  const supabase = client(base);

  const [{ data: listing }, { data: row }] = await Promise.all([
    supabase.from("opportunity_listings").select("status").eq("id", listingId).maybeSingle(),
    supabase.from("opportunity_recipients").select("status").eq("id", recipientId).eq("listing_id", listingId).maybeSingle(),
  ]);
  if (!listing || !row) fail(base, "Recipient not found.");
  if (!canManageRecipients(listing!.status as ListingStatus)) fail(base, "Unarchive this Opportunity before changing recipients.");
  const current = row!.status as RecipientStatus;
  const patch = buildAdminRecipientUpdate(current, next, new Date().toISOString());
  if (!patch) fail(base, `A ${current.replace("_", " ")} recipient can't move to ${next.replace("_", " ")}.`);

  const { data, error } = await supabase
    .from("opportunity_recipients")
    .update(patch!)
    .eq("id", recipientId)
    .eq("listing_id", listingId)
    .eq("status", current)
    .select("id")
    .maybeSingle();
  if (error || !data) fail(base, error?.message ?? "This recipient changed while you were editing. Please try again.");

  revalidateListing(listingId);
  redirect(`${base}?saved=recipient#recipient-${recipientId}`);
}

/** Admin-only note on one recipient. */
export async function saveRecipientNotes(listingId: string, recipientId: string, formData: FormData) {
  await requireAdmin();
  const base = detail(listingId);
  const supabase = client(base);
  const { data, error } = await supabase
    .from("opportunity_recipients")
    .update({ internal_notes: str(formData, "internal_notes") })
    .eq("id", recipientId)
    .eq("listing_id", listingId)
    .select("id")
    .maybeSingle();
  if (error || !data) fail(base, error?.message ?? "Recipient not found.");

  revalidateListing(listingId);
  redirect(`${base}?saved=notes#recipient-${recipientId}`);
}
