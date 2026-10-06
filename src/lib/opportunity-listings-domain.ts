// Opportunities V1 — the canonical, dependency-free domain rules for
// Findmi-authored commercial Opportunities (opportunity_listings) and their
// per-Business recipients (opportunity_recipients).
//
// NOT to be confused with src/lib/opportunities.ts, which is the EVENT
// PARTICIPATION workflow (Event invitations/applications, table
// public.opportunities). The two systems share no statuses or tables.
//
// This module has no imports on purpose: it is safe for server and client
// code alike, and testable directly (tests/opportunity-listings.test.mjs).
// Every value list here mirrors a CHECK constraint in
// supabase/migrations/20261006044707_opportunity_listings_v1.sql — change
// both together.

// ---------------------------------------------------------------- types

export const OPPORTUNITY_TYPES = [
  "activation",
  "sampling_demo",
  "vending",
  "sponsorship",
  "content",
  "partnership",
  "other",
] as const;
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

export const OPPORTUNITY_TYPE_LABELS: Record<OpportunityType, string> = {
  activation: "Activation",
  sampling_demo: "Sampling & Demo",
  vending: "Vending",
  sponsorship: "Sponsorship",
  content: "Content",
  partnership: "Partnership",
  other: "Opportunity",
};

export const LISTING_STATUSES = ["draft", "open", "closed", "archived"] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const RECIPIENT_STATUSES = [
  "offered",
  "interested",
  "not_interested",
  "confirmed",
  "completed",
  "cancelled",
  "withdrawn",
] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

export const PRICING_MODES = ["fixed", "starting_at", "complimentary", "custom"] as const;
export type PricingMode = (typeof PRICING_MODES)[number];

const isOneOf =
  <T extends string>(list: readonly T[]) =>
  (value: unknown): value is T =>
    typeof value === "string" && (list as readonly string[]).includes(value);

export const isOpportunityType = isOneOf(OPPORTUNITY_TYPES);
export const isListingStatus = isOneOf(LISTING_STATUSES);
export const isRecipientStatus = isOneOf(RECIPIENT_STATUSES);
export const isPricingMode = isOneOf(PRICING_MODES);

// ---------------------------------------------------------------- pricing

export interface PricingInput {
  pricing_mode: PricingMode;
  price_cents: number | null;
  credits_eligible: boolean;
}

/** Same rules as the database CHECKs, as a friendly message for forms.
 * Returns null when valid. */
export function validatePricing(input: PricingInput): string | null {
  const { pricing_mode, price_cents, credits_eligible } = input;
  if (!isPricingMode(pricing_mode)) return "Choose a pricing mode.";
  const needsAmount = pricing_mode === "fixed" || pricing_mode === "starting_at";
  if (needsAmount) {
    if (price_cents == null || !Number.isInteger(price_cents) || price_cents <= 0) return "Enter a price greater than $0.";
  } else if (price_cents != null) {
    return pricing_mode === "complimentary" ? "A complimentary Opportunity has no price." : "A custom-priced Opportunity has no fixed amount.";
  }
  if (credits_eligible && pricing_mode === "complimentary") return "A complimentary Opportunity can't be Opportunity Credit eligible.";
  return null;
}

/** "$750" / "Starting at $1,500" / "Complimentary" / "Contact Findmi".
 * Whole-dollar amounts drop the cents. */
export function formatOpportunityPrice(listing: { pricing_mode: PricingMode; price_cents: number | null; currency: string }): string {
  if (listing.pricing_mode === "complimentary") return "Complimentary";
  if (listing.pricing_mode === "custom" || listing.price_cents == null) return "Contact Findmi";
  const amount = listing.price_cents / 100;
  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: listing.currency || "USD",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return listing.pricing_mode === "starting_at" ? `Starting at ${money}` : money;
}

// ---------------------------------------------------------------- business responses

/** The only statuses a Business can choose, through Findmi. */
export const BUSINESS_RESPONSE_STATUSES = ["interested", "not_interested"] as const;
export type BusinessResponseStatus = (typeof BUSINESS_RESPONSE_STATUSES)[number];

/** Statuses from which a Business may still (re)answer — i.e. the
 * relationship hasn't moved into a Findmi-controlled outcome. */
const BUSINESS_ANSWERABLE: readonly RecipientStatus[] = ["offered", "interested", "not_interested"];

export type BusinessResponseRole = "owner" | "manager" | "staff";

export type ResponseCheck = { ok: true } | { ok: false; reason: string };

/** Canonical rule for a Business-originated response (the library and any
 * future server action both go through this):
 *   - owner/manager only (staff may view, never respond);
 *   - not via an admin Manage-As session (Findmi uses Admin status
 *     controls instead, so a Business response is never fabricated);
 *   - the listing is open;
 *   - the relationship is still offered/interested/not_interested;
 *   - the new status is interested/not_interested and actually changes.
 * offered->interested, offered->not_interested, not_interested->interested
 * and interested->not_interested are therefore the allowed moves. */
export function checkBusinessResponse(args: {
  role: BusinessResponseRole;
  viaAdmin?: boolean;
  listingStatus: ListingStatus;
  currentStatus: RecipientStatus;
  nextStatus: string;
}): ResponseCheck {
  if (args.viaAdmin) return { ok: false, reason: "Findmi admins update Opportunities from Admin, not by responding as the Business." };
  if (args.role !== "owner" && args.role !== "manager") return { ok: false, reason: "Only an owner or manager can respond to this Opportunity." };
  if (args.listingStatus !== "open") return { ok: false, reason: "This Opportunity is no longer taking responses." };
  if (!BUSINESS_ANSWERABLE.includes(args.currentStatus)) return { ok: false, reason: "Findmi is already handling this Opportunity with you." };
  if (args.nextStatus !== "interested" && args.nextStatus !== "not_interested") return { ok: false, reason: "That response isn't available." };
  if (args.nextStatus === args.currentStatus) return { ok: false, reason: "That's already your response." };
  return { ok: true };
}

// ---------------------------------------------------------------- admin transitions

/** Findmi-controlled moves (Admin). These never set responded_at /
 * responded_by_user_id — those only ever record a real Business response.
 * Reverts are included so an operator can correct a mistake. */
export const ADMIN_TRANSITIONS: Record<RecipientStatus, readonly RecipientStatus[]> = {
  offered: ["confirmed", "withdrawn"],
  interested: ["confirmed", "cancelled"],
  not_interested: ["withdrawn"],
  confirmed: ["completed", "cancelled", "interested"],
  completed: ["confirmed"],
  cancelled: ["confirmed"],
  withdrawn: ["offered"],
};

export function canAdminTransition(from: RecipientStatus, to: RecipientStatus): boolean {
  return ADMIN_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------- visibility

export type BusinessVisibility = "active" | "past" | "hidden";

const HISTORICAL_OUTCOMES: readonly RecipientStatus[] = ["not_interested", "confirmed", "completed", "cancelled"];

/** THE canonical rule for what a Business sees, given ITS OWN recipient
 * row (a row only exists once Findmi sent the Opportunity — offered_at is
 * always set). The caller must already have scoped to the Business.
 *
 *   hidden  — draft listing (never, regardless of recipient rows);
 *             withdrawn recipient;
 *             archived listing whose relationship never reached an outcome
 *             (offered/interested) — archiving is housekeeping, not a leak.
 *   active  — listing open and offered/interested/confirmed;
 *             a confirmed relationship stays active on a closed listing
 *             (it's still a live commitment).
 *   past    — not_interested/completed/cancelled on an open or closed
 *             listing; offered/interested on a closed listing (no longer
 *             answerable); and on an ARCHIVED listing, any real outcome
 *             (not_interested/confirmed/completed/cancelled) — archiving
 *             never erases a Business's legitimate history. */
export function getBusinessVisibility(listingStatus: ListingStatus, recipientStatus: RecipientStatus): BusinessVisibility {
  if (listingStatus === "draft" || recipientStatus === "withdrawn") return "hidden";
  if (listingStatus === "archived") return HISTORICAL_OUTCOMES.includes(recipientStatus) ? "past" : "hidden";
  if (recipientStatus === "confirmed") return "active";
  if (listingStatus === "open" && (recipientStatus === "offered" || recipientStatus === "interested")) return "active";
  return "past";
}

// ---------------------------------------------------------------- listing transitions

/** Admin listing lifecycle. Archive is housekeeping, never a delete, and
 * can be undone (archived -> closed). A listing can only be Opened once it
 * leaves Draft; a Closed listing can be Reopened. */
export const LISTING_TRANSITIONS: Record<ListingStatus, readonly ListingStatus[]> = {
  draft: ["open", "archived"],
  open: ["closed", "archived"],
  closed: ["open", "archived"],
  archived: ["closed"],
};

export function canListingTransition(from: ListingStatus, to: ListingStatus): boolean {
  return LISTING_TRANSITIONS[from]?.includes(to) ?? false;
}

export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  draft: "Draft",
  open: "Open",
  closed: "Closed",
  archived: "Archived",
};

/** Button copy for a listing move. */
export function listingTransitionLabel(from: ListingStatus, to: ListingStatus): string {
  if (to === "open") return from === "draft" ? "Open Opportunity" : "Reopen Opportunity";
  if (to === "closed") return from === "archived" ? "Unarchive" : "Close Opportunity";
  if (to === "archived") return "Archive";
  return LISTING_STATUS_LABELS[to];
}

// ---------------------------------------------------------------- recipient labels

export const RECIPIENT_STATUS_LABELS: Record<RecipientStatus, string> = {
  offered: "Offered",
  interested: "Interested",
  not_interested: "Not Interested",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
  withdrawn: "Withdrawn",
};

/** Button copy for an Admin recipient move (one entry per ADMIN_TRANSITIONS
 * edge). */
export function adminTransitionLabel(from: RecipientStatus, to: RecipientStatus): string {
  if (to === "confirmed") return from === "completed" || from === "cancelled" ? "Set Back to Confirmed" : "Confirm";
  if (to === "interested") return "Set Back to Interested";
  if (to === "offered") return "Re-offer";
  if (to === "withdrawn") return "Withdraw";
  if (to === "cancelled") return "Cancel";
  if (to === "completed") return "Complete";
  return RECIPIENT_STATUS_LABELS[to];
}

/** Recipient outcomes can be managed while a listing is open or closed.
 * An archived listing is read-only until it is unarchived. */
export function canManageRecipients(listingStatus: ListingStatus): boolean {
  return listingStatus === "open" || listingStatus === "closed";
}

/** The exact column patch an Admin recipient move writes, or null when the
 * move isn't canonical. Deliberately status + status_changed_at only —
 * never responded_at / responded_by_user_id / response_note, which only
 * ever record a real Business response. */
export function buildAdminRecipientUpdate(
  from: RecipientStatus,
  to: RecipientStatus,
  now: string
): { status: RecipientStatus; status_changed_at: string } | null {
  if (!canAdminTransition(from, to)) return null;
  return { status: to, status_changed_at: now };
}

// ---------------------------------------------------------------- send

export interface RecipientInsert {
  listing_id: string;
  business_id: string;
  status: "offered";
  fit_note: string | null;
  offered_at: string;
  status_changed_at: string;
}

export type SendPlan =
  | { ok: true; rows: RecipientInsert[]; skippedBusinessIds: string[] }
  | { ok: false; error: string };

export const FIT_NOTE_MAX = 1000;

/** Plans a Send: only an open listing; at least one Business; duplicates in
 * the selection collapse; Businesses that already have a row on this
 * listing are skipped (reported, never an error). Every new row starts
 * offered with offered_at = status_changed_at = now. */
export function planRecipientSend(args: {
  listingId: string;
  listingStatus: ListingStatus;
  businessIds: readonly string[];
  existingBusinessIds: readonly string[];
  fitNotes?: Readonly<Record<string, string | null | undefined>>;
  now: string;
}): SendPlan {
  if (args.listingStatus !== "open") return { ok: false, error: "Open this Opportunity before sending it to Businesses." };
  const unique = [...new Set(args.businessIds.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return { ok: false, error: "Choose at least one Business." };
  const existing = new Set(args.existingBusinessIds);
  const rows: RecipientInsert[] = [];
  const skippedBusinessIds: string[] = [];
  for (const businessId of unique) {
    if (existing.has(businessId)) {
      skippedBusinessIds.push(businessId);
      continue;
    }
    const note = args.fitNotes?.[businessId]?.trim();
    rows.push({
      listing_id: args.listingId,
      business_id: businessId,
      status: "offered",
      fit_note: note ? note.slice(0, FIT_NOTE_MAX) : null,
      offered_at: args.now,
      status_changed_at: args.now,
    });
  }
  return { ok: true, rows, skippedBusinessIds };
}

// ---------------------------------------------------------------- counts

export type RecipientCounts = { total: number } & Record<RecipientStatus, number>;

export function emptyRecipientCounts(): RecipientCounts {
  return { total: 0, offered: 0, interested: 0, not_interested: 0, confirmed: 0, completed: 0, cancelled: 0, withdrawn: 0 };
}

/** Per-listing, per-status recipient counts from ONE flat (listing_id,
 * status) read — no per-listing queries, no stored aggregates. */
export function summarizeRecipientCounts(rows: readonly { listing_id: string; status: RecipientStatus }[]): Map<string, RecipientCounts> {
  const out = new Map<string, RecipientCounts>();
  for (const r of rows) {
    const c = out.get(r.listing_id) ?? emptyRecipientCounts();
    c.total += 1;
    if (r.status in c) c[r.status] += 1;
    out.set(r.listing_id, c);
  }
  return out;
}

// ---------------------------------------------------------------- listing form

export const LISTING_TEXT_LIMITS = {
  title: 120,
  summary: 280,
  description: 8000,
  place_text: 160,
  host_name: 120,
  timing_note: 160,
  whats_included: 4000,
  requirements: 4000,
} as const;

/** Raw form values (strings as posted; times already ISO or null). */
export interface ListingFormInput {
  opportunity_type: string | null;
  title: string | null;
  summary: string | null;
  description: string | null;
  image_url: string | null;
  location_id: string | null;
  place_text: string | null;
  host_name: string | null;
  event_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  timing_note: string | null;
  response_deadline: string | null;
  pricing_mode: string | null;
  price: string | null;
  currency: string | null;
  credits_eligible: boolean;
  whats_included: string | null;
  requirements: string | null;
  internal_notes: string | null;
}

export interface ListingFields {
  opportunity_type: OpportunityType;
  title: string;
  summary: string | null;
  description: string | null;
  image_url: string | null;
  location_id: string | null;
  place_text: string | null;
  host_name: string | null;
  event_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  timing_note: string | null;
  response_deadline: string | null;
  pricing_mode: PricingMode;
  price_cents: number | null;
  currency: string;
  credits_eligible: boolean;
  whats_included: string | null;
  requirements: string | null;
  internal_notes: string | null;
}

/** "$1,500" / "750" / "750.5" / "750.00" -> cents; null when blank;
 * NaN when not a valid amount. */
export function parsePriceToCents(raw: string | null): number | null {
  const s = raw?.replace(/[$,\s]/g, "") ?? "";
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return Number.NaN;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** Server-side validation of a create/edit payload — the same rules as the
 * table CHECKs, as friendly messages. Amount is only read for Fixed /
 * Starting At; Complimentary is never credits eligible. Referenced
 * Location/Event existence is checked by the caller (needs the database). */
export function validateListingInput(input: ListingFormInput): { ok: true; value: ListingFields } | { ok: false; error: string } {
  if (!isOpportunityType(input.opportunity_type)) return { ok: false, error: "Choose an Opportunity type." };
  const title = blank(input.title);
  if (!title) return { ok: false, error: "Title is required." };

  const text: Record<keyof typeof LISTING_TEXT_LIMITS, string | null> = {
    title,
    summary: blank(input.summary),
    description: blank(input.description),
    place_text: blank(input.place_text),
    host_name: blank(input.host_name),
    timing_note: blank(input.timing_note),
    whats_included: blank(input.whats_included),
    requirements: blank(input.requirements),
  };
  for (const [key, max] of Object.entries(LISTING_TEXT_LIMITS) as [keyof typeof LISTING_TEXT_LIMITS, number][]) {
    if ((text[key]?.length ?? 0) > max) return { ok: false, error: `${FIELD_LABELS[key]} must be ${max.toLocaleString("en-US")} characters or fewer.` };
  }

  if (!isPricingMode(input.pricing_mode)) return { ok: false, error: "Choose a pricing mode." };
  const needsAmount = input.pricing_mode === "fixed" || input.pricing_mode === "starting_at";
  const price_cents = needsAmount ? parsePriceToCents(input.price) : null;
  if (needsAmount && (price_cents == null || Number.isNaN(price_cents))) return { ok: false, error: "Enter a price greater than $0." };
  const credits_eligible = input.pricing_mode === "complimentary" ? false : input.credits_eligible;
  const pricingError = validatePricing({ pricing_mode: input.pricing_mode, price_cents, credits_eligible });
  if (pricingError) return { ok: false, error: pricingError };

  const currency = (blank(input.currency) ?? "USD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: "Currency must be a 3-letter code, like USD." };

  for (const key of ["starts_at", "ends_at", "response_deadline"] as const) {
    const v = input[key];
    if (v && Number.isNaN(new Date(v).getTime())) return { ok: false, error: "One of the dates isn't valid." };
  }
  if (input.starts_at && input.ends_at && new Date(input.ends_at) < new Date(input.starts_at)) {
    return { ok: false, error: "Ends At can't be before Starts At." };
  }

  return {
    ok: true,
    value: {
      opportunity_type: input.opportunity_type,
      title,
      summary: text.summary,
      description: text.description,
      image_url: blank(input.image_url),
      location_id: blank(input.location_id),
      place_text: text.place_text,
      host_name: text.host_name,
      event_id: blank(input.event_id),
      starts_at: input.starts_at || null,
      ends_at: input.ends_at || null,
      timing_note: text.timing_note,
      response_deadline: input.response_deadline || null,
      pricing_mode: input.pricing_mode,
      price_cents,
      currency,
      credits_eligible,
      whats_included: text.whats_included,
      requirements: text.requirements,
      internal_notes: blank(input.internal_notes),
    },
  };
}

const FIELD_LABELS: Record<keyof typeof LISTING_TEXT_LIMITS, string> = {
  title: "Title",
  summary: "Summary",
  description: "Description",
  place_text: "Place",
  host_name: "Host name",
  timing_note: "Timing note",
  whats_included: "What's Included",
  requirements: "Requirements",
};

// ---------------------------------------------------------------- business-safe shapes

/** Listing columns a recipient Business may see. Deliberately excludes
 * internal_notes. */
export const BUSINESS_LISTING_COLUMNS =
  "id, status, opportunity_type, title, summary, description, image_url, location_id, place_text, host_name, event_id, starts_at, ends_at, timing_note, response_deadline, pricing_mode, price_cents, currency, credits_eligible, whats_included, requirements";

/** Recipient columns the Business may see on ITS OWN row. Deliberately
 * excludes internal_notes and responded_by_user_id. */
export const BUSINESS_RECIPIENT_COLUMNS = "id, listing_id, business_id, status, fit_note, response_note, offered_at, responded_at, status_changed_at";

// ---------------------------------------------------------------- presentation

/** Display headings for the commercial presentation. The database columns
 * keep their names (whats_included / requirements); only the reader-facing
 * labels differ. Shared by Admin and the future Business view. */
export const OPPORTUNITY_SECTION_LABELS = {
  description: "About This Opportunity",
  location: "Location & Host",
  whats_included: "What Findmi Provides",
  requirements: "What Your Brand Provides",
  timing: "Timing",
  investment: "Investment",
  event: "Related Event",
} as const;

export const PRICING_MODE_LABELS: Record<PricingMode, string> = {
  fixed: "Fixed",
  starting_at: "Starting At",
  complimentary: "Complimentary",
  custom: "Custom",
};

/** Big value + small qualifier for a price display: "$750" / "Fixed",
 * "$1,500" / "Starting At", "Complimentary" / null, "Contact Findmi" /
 * "Custom". */
export function opportunityPriceParts(listing: { pricing_mode: PricingMode; price_cents: number | null; currency: string }): {
  amount: string;
  qualifier: string | null;
} {
  if (listing.pricing_mode === "complimentary") return { amount: "Complimentary", qualifier: null };
  if (listing.pricing_mode === "custom" || listing.price_cents == null) return { amount: "Contact Findmi", qualifier: "Custom" };
  const amount = formatOpportunityPrice({ ...listing, pricing_mode: "fixed" });
  return { amount, qualifier: PRICING_MODE_LABELS[listing.pricing_mode] };
}

/** The read-only commercial presentation's input. Built field-by-field
 * (never spread from a row) so Admin-only columns — internal_notes,
 * created/updated stamps — can never reach a shared presentation
 * component, even when the source object is a full Admin row. */
export interface PresentableOpportunity {
  opportunity_type: OpportunityType;
  title: string;
  summary: string | null;
  description: string | null;
  image_url: string | null;
  place_text: string | null;
  host_name: string | null;
  starts_at: string | null;
  ends_at: string | null;
  timing_note: string | null;
  response_deadline: string | null;
  pricing_mode: PricingMode;
  price_cents: number | null;
  currency: string;
  credits_eligible: boolean;
  whats_included: string | null;
  requirements: string | null;
}

export function toPresentableOpportunity(row: PresentableOpportunity): PresentableOpportunity {
  return {
    opportunity_type: row.opportunity_type,
    title: row.title,
    summary: row.summary,
    description: row.description,
    image_url: row.image_url,
    place_text: row.place_text,
    host_name: row.host_name,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    timing_note: row.timing_note,
    response_deadline: row.response_deadline,
    pricing_mode: row.pricing_mode,
    price_cents: row.price_cents,
    currency: row.currency,
    credits_eligible: row.credits_eligible,
    whats_included: row.whats_included,
    requirements: row.requirements,
  };
}

/** Send / Add Businesses is only available on an open listing. */
export function canSendOpportunity(listingStatus: ListingStatus): boolean {
  return listingStatus === "open";
}

// ---------------------------------------------------------------- lifecycle (presentational)

export const LIFECYCLE_STAGES = ["draft", "open", "responses", "confirmed", "completed"] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export interface LifecycleStep {
  key: LifecycleStage;
  label: string;
  hint: string;
  state: "done" | "current" | "upcoming";
}

const LIFECYCLE_COPY: Record<LifecycleStage, { label: string; hint: string }> = {
  draft: { label: "Draft", hint: "Build and review details" },
  open: { label: "Open", hint: "Send to Businesses" },
  responses: { label: "Responses", hint: "Review interest" },
  confirmed: { label: "Confirmed", hint: "Move forward" },
  completed: { label: "Completed", hint: "Mark as complete" },
};

/** PRESENTATIONAL lifecycle: Draft → Open → Responses → Confirmed →
 * Completed, derived from the real listing status plus recipient counts —
 * nothing here is persisted. A draft is always at Draft. Otherwise the
 * furthest stage any recipient has reached is current (completed >
 * confirmed > any Business response > Open), earlier stages are done. A
 * closed/archived listing keeps the progress it reached; its own status
 * badge says it is closed/archived. */
export function getOpportunityLifecycle(listingStatus: ListingStatus, counts: Record<RecipientStatus, number>): LifecycleStep[] {
  let reached: LifecycleStage = "draft";
  if (listingStatus !== "draft") {
    if (counts.completed > 0) reached = "completed";
    else if (counts.confirmed > 0) reached = "confirmed";
    else if (counts.interested + counts.not_interested > 0) reached = "responses";
    else reached = "open";
  }
  const at = LIFECYCLE_STAGES.indexOf(reached);
  return LIFECYCLE_STAGES.map((key, i) => ({
    key,
    ...LIFECYCLE_COPY[key],
    state: i < at ? "done" : i === at ? "current" : "upcoming",
  }));
}

// ---------------------------------------------------------------- business-facing state

/** Business-facing names for the Business's OWN relationship. `offered` is
 * presented as "Recommended" (Findmi recommended it); withdrawn rows are
 * never shown to a Business (see getBusinessVisibility). */
export const BUSINESS_RECIPIENT_LABELS: Record<RecipientStatus, string> = {
  offered: "Recommended",
  interested: "Interested",
  not_interested: "Not Interested",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
  withdrawn: "Withdrawn",
};

export type BusinessOpportunityTone = "aqua" | "aquaSoft" | "positive" | "neutral" | "muted";

export interface BusinessOpportunityState {
  /** Badge text for the Business's relationship. */
  label: string;
  tone: BusinessOpportunityTone;
  /** The listing still takes Business responses and this relationship is
   * still answerable (role is checked separately). */
  answerable: boolean;
  /** Response choices offered right now (never more than the canonical
   * checkBusinessResponse allows). */
  choices: BusinessResponseStatus[];
  /** One short sentence for the decision area. */
  message: string;
}

/** THE Business-facing view of one relationship, from the listing status
 * and the Business's own recipient status. Mirrors checkBusinessResponse
 * (listing open + offered/interested/not_interested) so the page never
 * offers a choice the server would refuse. */
export function getBusinessOpportunityState(listingStatus: ListingStatus, recipientStatus: RecipientStatus): BusinessOpportunityState {
  const open = listingStatus === "open";
  switch (recipientStatus) {
    case "offered":
      return open
        ? { label: "Recommended", tone: "aqua", answerable: true, choices: ["interested", "not_interested"], message: "Let Findmi know if you'd like to pursue this. It's not a binding commitment." }
        : { label: "No Longer Available", tone: "muted", answerable: false, choices: [], message: "This Opportunity is no longer taking responses." };
    case "interested":
      return open
        ? { label: "Interested", tone: "aquaSoft", answerable: true, choices: ["not_interested"], message: "You've let Findmi know you're interested. Findmi will be in touch about next steps." }
        : { label: "Interested", tone: "aquaSoft", answerable: false, choices: [], message: "You let Findmi know you're interested. This Opportunity is no longer taking new responses." };
    case "not_interested":
      return open
        ? { label: "Not Interested", tone: "muted", answerable: true, choices: ["interested"], message: "You've passed on this Opportunity. You can change your mind while it's still open." }
        : { label: "Not Interested", tone: "muted", answerable: false, choices: [], message: "You passed on this Opportunity." };
    case "confirmed":
      return { label: "Confirmed", tone: "positive", answerable: false, choices: [], message: "You're confirmed. Findmi will coordinate the details with you." };
    case "completed":
      return { label: "Completed", tone: "neutral", answerable: false, choices: [], message: "This Opportunity is complete." };
    case "cancelled":
      return { label: "Cancelled", tone: "muted", answerable: false, choices: [], message: "This Opportunity was cancelled." };
    case "withdrawn":
      return { label: "Withdrawn", tone: "muted", answerable: false, choices: [], message: "This Opportunity is no longer available." };
  }
}

/** Can this member respond (UI gate; respondToOpportunityListing re-checks
 * everything server-side). */
export function canMemberRespond(role: BusinessResponseRole, viaAdmin?: boolean): boolean {
  return !viaAdmin && (role === "owner" || role === "manager");
}

/** Business-safe card/detail model for ONE relationship. Built field by
 * field: the Business's own status, fit note and timestamps plus the
 * presentable listing. Never internal notes, responder ids, listing
 * status, other recipients or counts. */
export interface BusinessOpportunityView {
  recipientId: string;
  status: RecipientStatus;
  state: BusinessOpportunityState;
  fitNote: string | null;
  offeredAt: string;
  respondedAt: string | null;
  opportunity: PresentableOpportunity;
}

export function toBusinessOpportunityView(
  recipient: { id: string; status: RecipientStatus; fit_note: string | null; offered_at: string; responded_at: string | null },
  listing: PresentableOpportunity & { status: ListingStatus }
): BusinessOpportunityView {
  return {
    recipientId: recipient.id,
    status: recipient.status,
    state: getBusinessOpportunityState(listing.status, recipient.status),
    fitNote: recipient.fit_note,
    offeredAt: recipient.offered_at,
    respondedAt: recipient.responded_at,
    opportunity: toPresentableOpportunity(listing),
  };
}

export const isBusinessResponseStatus = isOneOf(BUSINESS_RESPONSE_STATUSES);
