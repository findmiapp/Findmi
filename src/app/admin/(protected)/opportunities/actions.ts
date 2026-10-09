"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { bool, localDateTimeToIso, str } from "@/lib/admin/form-helpers";
import { getEntityManagerEmails } from "@/lib/notifications/recipients";
import { sendProductNotification } from "@/lib/notifications/productNotify";
import {
  buildAdminRecipientUpdate,
  canListingTransition,
  canManageRecipients,
  isListingStatus,
  isListingVisibility,
  isRecipientStatus,
  planRecipientSend,
  validateListingInput,
  type ListingFields,
  type ListingStatus,
  type RecipientStatus,
} from "@/lib/opportunity-listings-domain";
import { centsToDollarString, projectSafeLegacyPricing, toCommercialTermsRpcPayload, type LegacyBridgePricing, type OptionForPersistence } from "@/lib/opportunity-commercial-terms-bridge";
import { parseCommercialTermsForm } from "@/lib/opportunity-commercial-terms-form";
import { packageEditError } from "@/lib/opportunity-package-policy";
import { isMonetaryComponentType, validateOption, type MonetaryComponentType, type OptionFields, type OptionInput } from "@/lib/opportunity-commercial-terms-domain";

// Opportunities V1 Pass 2 — Admin writes for opportunity_listings /
// opportunity_recipients. Every action: requireAdmin() first, then the
// service-role client; every rule comes from the canonical domain module.
// Nothing here ever deletes a row, ever writes a Business response
// (responded_at / responded_by_user_id / response_note), or touches the
// Event participation `opportunities` table.
//
// Opportunities Cleanup Pass A — sendOpportunity now notifies each
// genuinely-newly-added recipient's Business (the handoff gap the audit
// found: a sent Opportunity previously had no notification at all).
//
// Commercial Terms Admin Builder (Pass 2) — createOpportunity always, and
// saveOpportunity ONLY WHEN THE LISTING ALREADY HAS >=1 OPTION ROW, also
// parse + persist the new Option/Component model (parseCommercialTermsForm
// -> validateOption, unchanged from Pass 1 -> the
// replace_opportunity_options RPC). When that's the case, the legacy
// pricing_mode/price_cents/currency columns are no longer taken directly
// from the form — they're PROJECTED from the submitted Options via
// projectSafeLegacyPricing (see opportunity-commercial-terms-bridge.ts for
// the full safety rule: never show a wrong amount or the wrong commercial
// direction, never flatten multiple Options by picking one arbitrarily).
//
// Pass 2 review correction — a listing with ZERO Option rows (never
// explicitly converted) is "legacy-unclassified": OpportunityForm never
// renders the builder for it (see its own `legacyUnclassified` prop), so
// saveOpportunity must NOT parse/derive/touch Commercial Terms for it at
// all. An ordinary, unrelated field edit (title, timing, etc.) preserves
// that listing's EXISTING legacy pricing_mode/price_cents/currency
// byte-for-byte — never derived, never guessed, never silently converted.
// Only convertLegacyToCommercialTerms (one explicit admin action) ever
// gives such a listing its first Option.
//
// credits_eligible stays its own independent form field, unrelated to the
// new model either way.

const LIST = "/admin/opportunities";
const detail = (id: string) => `${LIST}/${id}`;
const fail = (base: string, message: string): never => redirect(`${base}?error=${encodeURIComponent(message)}`);

function client(base: string) {
  const supabase = getAdminSupabase();
  if (!supabase) fail(base, "Storage isn't configured on the server.");
  return supabase!;
}

function readListingForm(formData: FormData, legacy: LegacyBridgePricing) {
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
    pricing_mode: legacy.pricing_mode,
    price: legacy.price,
    currency: legacy.currency,
    credits_eligible: bool(formData, "credits_eligible"),
    whats_included: str(formData, "whats_included"),
    requirements: str(formData, "requirements"),
    internal_notes: str(formData, "internal_notes"),
  });
}

/** What createOpportunity/saveOpportunity return when a save is rejected.
 * OpportunityForm keeps every entered value on screen and shows the error
 * (Builder UX pass) — a rejected save never redirects back to a form
 * rebuilt from the database. Success still redirects. */
type SaveResult = { error: string };

/** The one place createOpportunity/saveOpportunity call the aggregate-write
 * RPC. Never a second implementation of the Pass 1 persistence-contract
 * decision — see replace_opportunity_options' own migration comment. */
async function persistCommercialTerms(
  supabase: NonNullable<ReturnType<typeof getAdminSupabase>>,
  listingId: string,
  options: OptionForPersistence[]
): Promise<string | null> {
  const { error } = await supabase.rpc("replace_opportunity_options", {
    p_listing_id: listingId,
    p_options: toCommercialTermsRpcPayload(options),
  });
  return error ? error.message : null;
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

/** Create — always starts as a Draft. Commercial Terms are parsed and
 * validated BEFORE the listing is inserted, so a bad Option/Component
 * never gets as far as creating a listing row. Every new Opportunity is
 * authored through the builder, so its legacy compatibility columns are
 * always the SAFE projection (never a raw first-Option amount). */
export async function createOpportunity(formData: FormData): Promise<SaveResult | undefined> {
  await requireAdmin();
  const terms = parseCommercialTermsForm(formData);
  if (!terms.ok) return { error: terms.error };
  const options = terms.value;
  const packageError = packageEditError([], options);
  if (packageError) return { error: packageError };
  const legacy = projectSafeLegacyPricing(options);

  const parsed = readListingForm(formData, legacy);
  if (!parsed.ok) return { error: parsed.error };
  const fields = parsed.value;
  const supabase = getAdminSupabase();
  if (!supabase) return { error: "Storage isn't configured on the server." };
  const refError = await checkReferences(supabase, fields);
  if (refError) return { error: refError };

  const { data, error } = await supabase
    .from("opportunity_listings")
    .insert({ ...fields, status: "draft" })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Couldn't create the Opportunity." };

  const rpcError = await persistCommercialTerms(supabase, data.id, options);
  if (rpcError) {
    // The listing itself was created; only the Commercial Terms aggregate
    // write failed (atomically — no partial Options). Send the admin to the
    // now-real edit page to retry, rather than reporting success for a
    // listing with no Options, or staying on /new where a resubmit would
    // create a duplicate listing.
    revalidateListing();
    redirect(`${detail(data.id)}/edit?error=${encodeURIComponent("The Opportunity was created, but its Commercial Terms couldn't be saved. Please try again.")}`);
  }

  revalidateListing();
  redirect(`${detail(data.id)}?saved=created`);
}

/** Edit — every field except status. Errors return to the edit form;
 * success returns to the detail page. Existing Option ids submitted by the
 * builder are preserved by the RPC (stable ids across ordinary edits);
 * removed/added Options are reconciled in the same atomic call.
 *
 * Pass 2 review correction — whether this save touches Commercial Terms
 * at all is decided by the DATABASE (does this listing already own >=1
 * Option row?), never by trusting the submitted form: OpportunityForm
 * never renders the builder for a legacy-unclassified listing, so there
 * are no ct_* fields to read for one, and this function must not require
 * or invent any. Such a listing's legacy pricing_mode/price_cents/
 * currency are read back from its OWN current row and written back
 * UNCHANGED — an ordinary edit to the title, timing, etc. never derives,
 * guesses, or silently converts them. */
export async function saveOpportunity(id: string, formData: FormData): Promise<SaveResult | undefined> {
  await requireAdmin();
  const base = `${detail(id)}/edit`;
  const supabase = getAdminSupabase();
  if (!supabase) return { error: "Storage isn't configured on the server." };

  const { data: existingOptionRows } = await supabase.from("opportunity_options").select("id").eq("listing_id", id);
  const hasCommercialTerms = (existingOptionRows?.length ?? 0) > 0;

  let legacy: LegacyBridgePricing;
  let options: OptionForPersistence[] | null = null;
  if (hasCommercialTerms) {
    const terms = parseCommercialTermsForm(formData);
    if (!terms.ok) return { error: terms.error };
    options = terms.value;
    // Temporary single-package policy — existing packages stay editable;
    // nothing can add one (see opportunity-package-policy.ts).
    const packageError = packageEditError(
      (existingOptionRows ?? []).map((r) => r.id as string),
      options
    );
    if (packageError) return { error: packageError };
    legacy = projectSafeLegacyPricing(options);
  } else {
    const { data: current } = await supabase.from("opportunity_listings").select("pricing_mode, price_cents, currency").eq("id", id).maybeSingle();
    if (!current) return { error: "Opportunity not found." };
    legacy = {
      pricing_mode: current.pricing_mode,
      price: current.price_cents != null ? centsToDollarString(current.price_cents) : null,
      currency: current.currency,
    };
  }

  const parsed = readListingForm(formData, legacy);
  if (!parsed.ok) return { error: parsed.error };
  const fields = parsed.value;
  const refError = await checkReferences(supabase, fields);
  if (refError) return { error: refError };

  const { data, error } = await supabase.from("opportunity_listings").update(fields).eq("id", id).select("id").maybeSingle();
  if (error || !data) return { error: error?.message ?? "Opportunity not found." };

  if (hasCommercialTerms && options) {
    // Atomic aggregate write — on failure no Option/Component changed; the
    // admin stays on the form with everything still entered and can retry.
    const rpcError = await persistCommercialTerms(supabase, id, options);
    if (rpcError) {
      revalidateListing(id);
      return { error: "Changes were saved, but Commercial Terms couldn't be updated. Please try again." };
    }
  }

  revalidateListing(id);
  revalidatePath(base);
  redirect(`${detail(id)}?saved=updated`);
}

/** Legacy classification — the ONE explicit way a pre-Pass-2 Opportunity
 * (zero opportunity_options rows) gets its first Option. Never automatic:
 * only reachable from the dedicated "Convert to Commercial Terms" control,
 * never triggered by saving any other field. Refuses outright if the
 * listing already has Options (classification happens exactly once; after
 * that, the normal builder on the edit form is how it's changed). A
 * Complimentary/Custom legacy row converts with no extra input (those
 * modes carry no ambiguity); a Fixed/Starting At row requires the admin to
 * say which monetary direction the amount represents — never guessed. */
export async function convertLegacyToCommercialTerms(id: string, formData: FormData) {
  await requireAdmin();
  const base = detail(id);
  const supabase = client(base);

  const [{ data: listing }, { data: existingOptions }] = await Promise.all([
    supabase.from("opportunity_listings").select("pricing_mode, price_cents, currency").eq("id", id).maybeSingle(),
    supabase.from("opportunity_options").select("id").eq("listing_id", id).limit(1),
  ]);
  if (!listing) fail(base, "Opportunity not found.");
  if (existingOptions && existingOptions.length > 0) fail(base, "This Opportunity already has Commercial Terms.");

  let input: OptionInput;
  if (listing!.pricing_mode === "complimentary") {
    input = { commercial_mode: "complimentary", components: [] };
  } else if (listing!.pricing_mode === "custom") {
    input = { commercial_mode: "custom", components: [] };
  } else {
    const componentType = str(formData, "component_type");
    if (!isMonetaryComponentType(componentType)) fail(base, "Choose what this amount represents.");
    input = {
      commercial_mode: "structured",
      components: [
        {
          component_type: componentType as MonetaryComponentType,
          amount_mode: listing!.pricing_mode,
          amount_min_cents: listing!.price_cents,
          currency: listing!.currency,
        },
      ],
    };
  }

  const result = validateOption(input);
  if (!result.ok) fail(base, result.error);
  const value = (result as { ok: true; value: OptionFields }).value;

  const rpcError = await persistCommercialTerms(supabase, id, [{ ...value, id: null }]);
  if (rpcError) fail(base, "Couldn't convert this Opportunity's commercial terms. Please try again.");

  revalidateListing(id);
  redirect(`${base}?saved=converted#commercial-terms`);
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
    supabase.from("opportunity_listings").select("status, title").eq("id", id).maybeSingle(),
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
      .select("id, business_id");
    if (error) fail(base, error.message);
    const insertedRows = (inserted ?? []) as { id: string; business_id: string }[];
    const insertedIds = new Set(insertedRows.map((r) => r.business_id));
    sent = insertedIds.size;
    // A row that lost a race to a concurrent send is a skip, not a failure.
    for (const r of rows) if (!insertedIds.has(r.business_id)) skippedBusinessIds.push(r.business_id);

    // Opportunities Cleanup Pass A — notify only the Businesses a row was
    // genuinely just created for. A repeat send against an
    // already-existing recipient never reaches this loop (it was filtered
    // into skippedBusinessIds above instead), so re-sending can never
    // duplicate this notification. Recipient resolution is the same
    // canonical getEntityManagerEmails("business", ...) helper every other
    // product notification already uses — not a new ad-hoc "every member"
    // scan.
    await Promise.all(
      insertedRows.map(async (r) => {
        const to = await getEntityManagerEmails(supabase, "business", r.business_id);
        await sendProductNotification({
          to,
          type: "opportunity_listing_sent",
          subject: `New Opportunity from Findmi: ${listing!.title}`,
          heading: "Findmi selected an Opportunity for your Business",
          body: [`Findmi sent "${listing!.title}" to your Business. Review it and let us know if you're interested.`],
          actionLabel: "Review Opportunity",
          actionUrl: `/account/business/${r.business_id}/opportunities/${r.id}`,
        });
      })
    );
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

/** Opportunities V2 — Make Discoverable / Make Private. Discoverable open
 * listings appear in the Business Explore view; private listings are only
 * reachable by their recipients. Writes only `visibility` (a separate
 * action so the main edit form keeps working before the V2 migration). */
export async function setListingVisibility(id: string, visibility: string) {
  await requireAdmin();
  const base = detail(id);
  if (!isListingVisibility(visibility)) fail(base, "Unknown visibility.");
  const supabase = client(base);
  const { data, error } = await supabase.from("opportunity_listings").update({ visibility }).eq("id", id).select("id").maybeSingle();
  if (error) fail(base, /visibility/.test(error.message) ? "Discoverability needs the pending database migration." : error.message);
  if (!data) fail(base, "Opportunity not found.");
  revalidateListing(id);
  redirect(`${base}?saved=visibility-${visibility}`);
}
