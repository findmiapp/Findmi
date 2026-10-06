import "server-only";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { requireAdmin } from "@/lib/admin/auth";
import { isEmailVerified, requireBusinessMember } from "@/lib/permissions";
import { getCurrentUserId } from "@/lib/journal";
import {
  BUSINESS_LISTING_COLUMNS,
  BUSINESS_RECIPIENT_COLUMNS,
  checkBusinessResponse,
  getBusinessVisibility,
  emptyRecipientCounts,
  summarizeRecipientCounts,
  toBusinessOpportunityView,
  type BusinessOpportunityView,
  type BusinessResponseStatus,
  type RecipientCounts,
  type BusinessVisibility,
  type ListingStatus,
  type OpportunityType,
  type PricingMode,
  type RecipientStatus,
} from "@/lib/opportunity-listings-domain";

// Opportunities V1 — server data access for Findmi-authored commercial
// Opportunities (opportunity_listings + opportunity_recipients).
//
// NOT src/lib/opportunities.ts (the EVENT PARTICIPATION workflow).
//
// Both tables are server-only (RLS on, no anon/authenticated policies or
// grants), so every function here reads/writes through the service-role
// client AFTER its own authorization:
//   - Business functions: requireBusinessMember(businessId); explicit
//     Business-safe columns only (never internal_notes, never another
//     Business's row); visibility via getBusinessVisibility (domain).
//   - Admin functions: requireAdmin(); full rows.
// Domain rules (statuses, pricing, transitions, visibility) live in
// src/lib/opportunity-listings-domain.ts — this file never re-derives them.

// ---------------------------------------------------------------- select shapes

// The explicit Business-safe column lists live in the domain module (so
// tests can check them); re-exported here for existing callers.
export { BUSINESS_LISTING_COLUMNS, BUSINESS_RECIPIENT_COLUMNS };

export interface BusinessOpportunityListing {
  id: string;
  status: ListingStatus;
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
}

export interface BusinessOpportunityRecipient {
  id: string;
  listing_id: string;
  business_id: string;
  status: RecipientStatus;
  response_note: string | null;
  offered_at: string;
  responded_at: string | null;
  status_changed_at: string;
}

export interface BusinessOpportunity {
  recipient: BusinessOpportunityRecipient;
  listing: BusinessOpportunityListing;
  visibility: Exclude<BusinessVisibility, "hidden">;
}

/** Full rows — Admin only. */
export interface AdminOpportunityListing extends BusinessOpportunityListing {
  internal_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminOpportunityRecipient extends BusinessOpportunityRecipient {
  /** Admin-only — never part of the Business shape. */
  fit_note: string | null;
  internal_notes: string | null;
  responded_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  business: { id: string; name: string; slug: string } | null;
}

type RecipientWithListing = BusinessOpportunityRecipient & {
  listing: BusinessOpportunityListing | BusinessOpportunityListing[] | null;
};

function toBusinessOpportunity(row: RecipientWithListing): BusinessOpportunity | null {
  const listing = Array.isArray(row.listing) ? (row.listing[0] ?? null) : row.listing;
  if (!listing) return null;
  const visibility = getBusinessVisibility(listing.status, row.status);
  if (visibility === "hidden") return null;
  const { listing: _listing, ...recipient } = row;
  return { recipient, listing, visibility };
}

function requireAdminClient() {
  const admin = getAdminSupabase();
  if (!admin) throw new Error("Opportunities are unavailable right now.");
  return admin;
}

// ---------------------------------------------------------------- business reads

/** One Business's commercial Opportunities, split into Active and Past.
 * Any member role (owner/manager/staff) may read. Drafts, withdrawn rows
 * and other Businesses' rows can never appear: the query is scoped to this
 * business_id, excludes withdrawn/draft in SQL, and every row then passes
 * the canonical getBusinessVisibility rule. */
export async function getBusinessOpportunities(businessId: string): Promise<{ active: BusinessOpportunity[]; past: BusinessOpportunity[] }> {
  await requireBusinessMember(businessId);
  const admin = requireAdminClient();
  const { data, error } = await admin
    .from("opportunity_recipients")
    .select(`${BUSINESS_RECIPIENT_COLUMNS}, listing:opportunity_listings!inner(${BUSINESS_LISTING_COLUMNS})`)
    .eq("business_id", businessId)
    .neq("status", "withdrawn")
    .neq("listing.status", "draft")
    .order("offered_at", { ascending: false });
  if (error || !data) return { active: [], past: [] };

  const active: BusinessOpportunity[] = [];
  const past: BusinessOpportunity[] = [];
  for (const row of data as unknown as RecipientWithListing[]) {
    const item = toBusinessOpportunity(row);
    if (item) (item.visibility === "active" ? active : past).push(item);
  }
  return { active, past };
}

/** One Opportunity for one Business (detail view), or null when it isn't
 * visible to that Business. */
export async function getBusinessOpportunity(businessId: string, recipientId: string): Promise<BusinessOpportunity | null> {
  await requireBusinessMember(businessId);
  const admin = requireAdminClient();
  const { data } = await admin
    .from("opportunity_recipients")
    .select(`${BUSINESS_RECIPIENT_COLUMNS}, listing:opportunity_listings!inner(${BUSINESS_LISTING_COLUMNS})`)
    .eq("id", recipientId)
    .eq("business_id", businessId)
    .maybeSingle();
  return data ? toBusinessOpportunity(data as unknown as RecipientWithListing) : null;
}

/** Count of brand-new (offered, open) Opportunities — for a Home/command-
 * center badge. Same visibility rule. */
export async function countNewBusinessOpportunities(businessId: string): Promise<number> {
  const { active } = await getBusinessOpportunities(businessId);
  return active.filter((o) => o.recipient.status === "offered").length;
}

// ---------------------------------------------------------------- business response

export type BusinessResponseResult = { ok: true; status: BusinessResponseStatus } | { ok: false; error: string };

/** The canonical Business response write (I'm Interested / Not Interested).
 * Owner/manager only, real signed-in user with a verified email, never via
 * admin Manage-As, listing open, own row, permitted transition (domain
 * checkBusinessResponse). Records responded_at / responded_by_user_id —
 * the ONLY place those are ever written. The update is conditional on the
 * status it was read in, so a concurrent Admin change can't be overwritten. */
export async function respondToOpportunityListing(args: {
  businessId: string;
  recipientId: string;
  response: BusinessResponseStatus;
  note?: string | null;
}): Promise<BusinessResponseResult> {
  const membership = await requireBusinessMember(args.businessId);
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Please sign in to respond." };
  const admin = requireAdminClient();
  if (!(await isEmailVerified(admin, userId))) return { ok: false, error: "Verify your email to respond to Opportunities." };

  const { data } = await admin
    .from("opportunity_recipients")
    .select("id, business_id, status, listing:opportunity_listings!inner(status)")
    .eq("id", args.recipientId)
    .eq("business_id", args.businessId)
    .maybeSingle();
  if (!data) return { ok: false, error: "This Opportunity isn't available." };
  const row = data as unknown as { status: RecipientStatus; listing: { status: ListingStatus } | { status: ListingStatus }[] };
  const listingStatus = (Array.isArray(row.listing) ? row.listing[0] : row.listing)?.status;
  if (!listingStatus || getBusinessVisibility(listingStatus, row.status) === "hidden") return { ok: false, error: "This Opportunity isn't available." };

  const check = checkBusinessResponse({
    role: membership.role,
    viaAdmin: membership.viaAdmin,
    listingStatus,
    currentStatus: row.status,
    nextStatus: args.response,
  });
  if (!check.ok) return { ok: false, error: check.reason };

  const note = args.note?.trim() ? args.note.trim().slice(0, 1000) : null;
  const now = new Date().toISOString();
  const { data: updated, error } = await admin
    .from("opportunity_recipients")
    .update({ status: args.response, response_note: note, responded_at: now, responded_by_user_id: userId, status_changed_at: now })
    .eq("id", args.recipientId)
    .eq("business_id", args.businessId)
    .eq("status", row.status)
    .select("id")
    .maybeSingle();
  if (error || !updated) return { ok: false, error: "Couldn't save your response. Please try again." };
  return { ok: true, status: args.response };
}

// ---------------------------------------------------------------- admin reads

/** All listings, newest first, optionally by status — Admin only. */
export async function getAdminOpportunityListings(status?: ListingStatus): Promise<AdminOpportunityListing[]> {
  await requireAdmin();
  const admin = requireAdminClient();
  let query = admin.from("opportunity_listings").select("*").order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data } = await query;
  return (data ?? []) as AdminOpportunityListing[];
}

/** One listing with every recipient (and its Business) — Admin only. */
export async function getAdminOpportunityListing(
  listingId: string
): Promise<{ listing: AdminOpportunityListing; recipients: AdminOpportunityRecipient[] } | null> {
  await requireAdmin();
  const admin = requireAdminClient();
  const [{ data: listing }, { data: recipients }] = await Promise.all([
    admin.from("opportunity_listings").select("*").eq("id", listingId).maybeSingle(),
    admin
      .from("opportunity_recipients")
      .select("*, business:businesses(id, name, slug)")
      .eq("listing_id", listingId)
      .order("offered_at", { ascending: true }),
  ]);
  if (!listing) return null;
  return {
    listing: listing as AdminOpportunityListing,
    recipients: ((recipients ?? []) as (AdminOpportunityRecipient & { business: AdminOpportunityRecipient["business"] | AdminOpportunityRecipient["business"][] })[]).map(
      (r) => ({ ...r, business: Array.isArray(r.business) ? (r.business[0] ?? null) : r.business })
    ),
  };
}

export interface AdminOpportunityListingSummary extends AdminOpportunityListing {
  location: { id: string; name: string } | null;
  counts: RecipientCounts;
}

/** Admin list: listings (optionally by status) with their Location name and
 * recipient counts. Two queries total — the listings, then one flat
 * (listing_id, status) read of their recipients aggregated in memory. No
 * per-listing queries, no stored aggregates. */
export async function getAdminOpportunityListingSummaries(status?: ListingStatus): Promise<AdminOpportunityListingSummary[]> {
  await requireAdmin();
  const admin = requireAdminClient();
  let query = admin.from("opportunity_listings").select("*, location:locations(id, name)").order("updated_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data } = await query;
  const listings = (data ?? []) as (AdminOpportunityListing & { location: { id: string; name: string } | { id: string; name: string }[] | null })[];
  if (listings.length === 0) return [];

  const { data: recipientRows } = await admin
    .from("opportunity_recipients")
    .select("listing_id, status")
    .in(
      "listing_id",
      listings.map((l) => l.id)
    );
  const counts = summarizeRecipientCounts((recipientRows ?? []) as { listing_id: string; status: RecipientStatus }[]);
  return listings.map((l) => ({
    ...l,
    location: Array.isArray(l.location) ? (l.location[0] ?? null) : l.location,
    counts: counts.get(l.id) ?? emptyRecipientCounts(),
  }));
}

/** Display context for the commercial presentation. Public-facing columns
 * only, so the same shape can serve the future Business view. */
export interface OpportunityPlace {
  id: string;
  name: string;
  slug: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
}

export interface OpportunityEventRef {
  id: string;
  name: string;
  slug: string | null;
  start_at: string | null;
}

/** The linked Location and Event for one listing — Admin only. */
export async function getAdminOpportunityContext(listing: {
  location_id: string | null;
  event_id: string | null;
}): Promise<{ location: OpportunityPlace | null; event: OpportunityEventRef | null }> {
  await requireAdmin();
  const admin = requireAdminClient();
  const [location, event] = await Promise.all([
    listing.location_id
      ? admin.from("locations").select("id, name, slug, address, city, state").eq("id", listing.location_id).maybeSingle()
      : null,
    listing.event_id ? admin.from("events").select("id, name, slug, start_at").eq("id", listing.event_id).maybeSingle() : null,
  ]);
  return {
    location: (location?.data as OpportunityPlace | null) ?? null,
    event: (event?.data as OpportunityEventRef | null) ?? null,
  };
}

// ---------------------------------------------------------------- business views

/** Public context columns embedded with a Business read — the same public
 * fields any visitor sees on the Location/Event pages. */
const BUSINESS_CONTEXT_EMBEDS = "location:locations(name, slug, address, city, state), event:events(name, slug, start_at)";

export interface BusinessOpportunityPlace {
  name: string;
  slug: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
}

export interface BusinessOpportunityEvent {
  name: string;
  slug: string | null;
  start_at: string | null;
}

export interface BusinessOpportunityItem {
  view: BusinessOpportunityView;
  visibility: Exclude<BusinessVisibility, "hidden">;
  place: BusinessOpportunityPlace | null;
  event: BusinessOpportunityEvent | null;
}

type BusinessRow = BusinessOpportunityRecipient & {
  listing:
    | (BusinessOpportunityListing & { location: BusinessOpportunityPlace | BusinessOpportunityPlace[] | null; event: BusinessOpportunityEvent | BusinessOpportunityEvent[] | null })
    | null;
};

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** Raw row -> Business-safe item, or null when not visible. Location/Event
 * are re-picked to their public fields. */
function toBusinessItem(row: BusinessRow): BusinessOpportunityItem | null {
  const listing = one(row.listing);
  if (!listing) return null;
  const visibility = getBusinessVisibility(listing.status, row.status);
  if (visibility === "hidden") return null;
  const loc = one(listing.location);
  const ev = one(listing.event);
  return {
    view: toBusinessOpportunityView(row, listing),
    visibility,
    place: loc ? { name: loc.name, slug: loc.slug, address: loc.address, city: loc.city, state: loc.state } : null,
    event: ev ? { name: ev.name, slug: ev.slug, start_at: ev.start_at } : null,
  };
}

/** This Business's commercial Opportunities as Business-safe items, split
 * Active / Past. Any member role may read. Scoped to business_id in SQL
 * (never another Business's rows); drafts/withdrawn excluded in SQL and by
 * the canonical visibility rule. */
export async function getBusinessOpportunityItems(businessId: string): Promise<{ active: BusinessOpportunityItem[]; past: BusinessOpportunityItem[] }> {
  await requireBusinessMember(businessId);
  const admin = requireAdminClient();
  const { data, error } = await admin
    .from("opportunity_recipients")
    .select(`${BUSINESS_RECIPIENT_COLUMNS}, listing:opportunity_listings!inner(${BUSINESS_LISTING_COLUMNS}, ${BUSINESS_CONTEXT_EMBEDS})`)
    .eq("business_id", businessId)
    .neq("status", "withdrawn")
    .neq("listing.status", "draft")
    .order("offered_at", { ascending: false });
  if (error || !data) return { active: [], past: [] };
  const active: BusinessOpportunityItem[] = [];
  const past: BusinessOpportunityItem[] = [];
  for (const row of data as unknown as BusinessRow[]) {
    const item = toBusinessItem(row);
    if (item) (item.visibility === "active" ? active : past).push(item);
  }
  return { active, past };
}

/** One relationship for one Business (detail page), or null when it isn't
 * this Business's or isn't visible to it. The recipient id alone is never
 * enough: the row must also carry this business_id. */
export async function getBusinessOpportunityItem(businessId: string, recipientId: string): Promise<BusinessOpportunityItem | null> {
  await requireBusinessMember(businessId);
  const admin = requireAdminClient();
  const { data } = await admin
    .from("opportunity_recipients")
    .select(`${BUSINESS_RECIPIENT_COLUMNS}, listing:opportunity_listings!inner(${BUSINESS_LISTING_COLUMNS}, ${BUSINESS_CONTEXT_EMBEDS})`)
    .eq("id", recipientId)
    .eq("business_id", businessId)
    .maybeSingle();
  return data ? toBusinessItem(data as unknown as BusinessRow) : null;
}
