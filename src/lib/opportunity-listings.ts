import "server-only";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { requireAdmin } from "@/lib/admin/auth";
import { isEmailVerified, requireBusinessMember } from "@/lib/permissions";
import { getCurrentUserId } from "@/lib/journal";
import { notifyAdmin } from "@/lib/notifications/adminNotify";
import {
  BUSINESS_LISTING_COLUMNS,
  BUSINESS_RECIPIENT_COLUMNS,
  checkBusinessResponse,
  getBusinessVisibility,
  checkExploreInterest,
  emptyRecipientCounts,
  isExplorable,
  matchesExploreFilters,
  summarizeRecipientCounts,
  toPresentableOpportunity,
  type ExploreFilters,
  type PresentableOpportunity,
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
import { matchesParticipationCost } from "@/lib/opportunity-participation-cost";
import { CHOOSE_PACKAGE_MESSAGE, requiresPackageChoice } from "@/lib/opportunity-package-policy";

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
  /** Opportunities V2 — absent until the V2 migration is applied. */
  visibility?: "private" | "discoverable";
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
 * status it was read in, so a concurrent Admin change can't be overwritten.
 *
 * Opportunities Cleanup Pass A — a response also sends Admin a best-effort
 * notifyAdmin() (the only way Admin would otherwise learn of it, since
 * there's no messaging/reply thread here). Never blocks or changes the
 * response result: notifyAdmin never throws. */
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
    .select("id, business_id, listing_id, status, listing:opportunity_listings!inner(status, title), business:businesses(name)")
    .eq("id", args.recipientId)
    .eq("business_id", args.businessId)
    .maybeSingle();
  if (!data) return { ok: false, error: "This Opportunity isn't available." };
  const row = data as unknown as {
    status: RecipientStatus;
    listing_id: string;
    listing: { status: ListingStatus; title: string } | { status: ListingStatus; title: string }[];
    business: { name: string } | { name: string }[] | null;
  };
  const listingRow = Array.isArray(row.listing) ? row.listing[0] : row.listing;
  const listingStatus = listingRow?.status;
  if (!listingStatus || getBusinessVisibility(listingStatus, row.status) === "hidden") return { ok: false, error: "This Opportunity isn't available." };

  const check = checkBusinessResponse({
    role: membership.role,
    viaAdmin: membership.viaAdmin,
    listingStatus,
    currentStatus: row.status,
    nextStatus: args.response,
  });
  if (!check.ok) return { ok: false, error: check.reason };

  // Temporary single-package policy: an Opportunity-level "I'm Interested"
  // on a multi-package listing would not say which package — refused here,
  // server-side, not just hidden in the UI. Not Interested stays allowed.
  if (args.response === "interested") {
    const packages = await countOpportunityPackages(admin, row.listing_id);
    if (packages == null) return { ok: false, error: "Couldn't save your response. Please try again." };
    if (requiresPackageChoice(packages)) return { ok: false, error: CHOOSE_PACKAGE_MESSAGE };
  }

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

  const businessName = (Array.isArray(row.business) ? row.business[0] : row.business)?.name ?? "A Business";
  const listingTitle = listingRow?.title ?? "an Opportunity";
  await notifyAdmin({
    subject: args.response === "interested" ? `${businessName} is interested: ${listingTitle}` : `${businessName} passed: ${listingTitle}`,
    heading: args.response === "interested" ? "A Business is interested in an Opportunity" : "A Business passed on an Opportunity",
    body: [`${businessName} marked "${listingTitle}" as ${args.response === "interested" ? "Interested" : "Not Interested"}.`],
    actionLabel: "Review Opportunity",
    actionUrl: `/admin/opportunities/${row.listing_id}#recipient-${args.recipientId}`,
  });

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

// ---------------------------------------------------------------- commercial terms (Pass 2)

/** One Option + its Components exactly as stored — Admin only. Shaped to
 * feed straight into OptionForPersistence (src/lib/
 * opportunity-commercial-terms-bridge.ts) for the builder's initial state,
 * and into formatOptionSummary/formatOptionalContributions for display. */
export interface AdminOpportunityOption {
  id: string;
  listing_id: string;
  name: string | null;
  description: string | null;
  commercial_mode: string;
  custom_terms_note: string | null;
  display_order: number;
  components: AdminOpportunityComponent[];
}

export interface AdminOpportunityComponent {
  id: string;
  component_type: string;
  amount_mode: string | null;
  amount_min_cents: number | null;
  amount_max_cents: number | null;
  currency: string | null;
  in_kind_category: string | null;
  in_kind_description: string | null;
  in_kind_provider: string | null;
  in_kind_required: boolean;
  estimated_value_cents: number | null;
  quantity: number | null;
  unit: string | null;
  custom_unit_label: string | null;
  unit_value_cents: number | null;
  display_order: number;
}

/** How many packages (opportunity_options rows) a listing has, or null on
 * a read error — FAIL-CLOSED for the temporary single-package response
 * gate (opportunity-package-policy.ts): a caller treats null as "can't
 * verify", never as zero. The only other direct read of the Options table
 * besides getOpportunityOptionsForListings, and count-only. */
async function countOpportunityPackages(admin: ReturnType<typeof requireAdminClient>, listingId: string): Promise<number | null> {
  const { count, error } = await admin.from("opportunity_options").select("id", { count: "exact", head: true }).eq("listing_id", listingId);
  return error ? null : (count ?? 0);
}

/** Options+Components for MANY listings in one query — the shared,
 * UNGATED reader both Admin (single-listing) and Business (Pass 3) reads
 * delegate to. No admin-only field exists on either table (unlike
 * internal_notes/fit_note on listings/recipients), so there is no
 * Business-safe column subset to carve out here — the caller's OWN
 * authorization (requireAdmin or requireBusinessMember, already done one
 * level up) is what gates reachability; this function trusts that and
 * does no gating of its own, exactly like getAdminOpportunityContext's
 * sibling reads. Returns a Map so a caller fetching many listings (Explore,
 * a Business's own item list) does ONE query, never N+1. */
export async function getOpportunityOptionsForListings(listingIds: readonly string[]): Promise<Map<string, AdminOpportunityOption[]>> {
  const out = new Map<string, AdminOpportunityOption[]>();
  if (listingIds.length === 0) return out;
  const admin = requireAdminClient();
  const { data, error } = await admin
    .from("opportunity_options")
    .select("*, components:opportunity_option_components(*)")
    .in("listing_id", listingIds)
    .order("display_order", { ascending: true });
  if (error || !data) return out;
  for (const row of data as unknown as (AdminOpportunityOption & { components: AdminOpportunityComponent[] })[]) {
    const option: AdminOpportunityOption = { ...row, components: [...row.components].sort((a, b) => a.display_order - b.display_order) };
    const existing = out.get(row.listing_id) ?? [];
    existing.push(option);
    out.set(row.listing_id, existing);
  }
  return out;
}

/** Every Option (+ its Components) for one listing, ordered the same way
 * the builder and the detail view present them. An empty array is exactly
 * how a not-yet-classified legacy listing is distinguished — see
 * isLegacyUnclassified() in the bridge module. Admin only (requireAdmin);
 * delegates to the shared, ungated batched reader above. */
export async function getAdminOpportunityOptions(listingId: string): Promise<AdminOpportunityOption[]> {
  await requireAdmin();
  const byListing = await getOpportunityOptionsForListings([listingId]);
  return byListing.get(listingId) ?? [];
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
  /** Pass 3 — this listing's structured Options (+Components), for the
   * Business-facing commercial presentation. Empty array for a legacy-
   * unclassified listing (zero opportunity_options rows) — the presentation
   * layer then falls back to the legacy pricing_mode/price_cents view. */
  options: AdminOpportunityOption[];
}

type BusinessRow = BusinessOpportunityRecipient & {
  listing:
    | (BusinessOpportunityListing & { location: BusinessOpportunityPlace | BusinessOpportunityPlace[] | null; event: BusinessOpportunityEvent | BusinessOpportunityEvent[] | null })
    | null;
};

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** Raw row -> Business-safe item, or null when not visible. Location/Event
 * are re-picked to their public fields. `options` defaults to empty (legacy-
 * unclassified) when the caller has no batched Options map for this row. */
function toBusinessItem(row: BusinessRow, options: AdminOpportunityOption[] = []): BusinessOpportunityItem | null {
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
    options,
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
  const rows = data as unknown as BusinessRow[];
  const optionsByListing = await getOpportunityOptionsForListings(rows.map((r) => r.listing_id));
  const active: BusinessOpportunityItem[] = [];
  const past: BusinessOpportunityItem[] = [];
  for (const row of rows) {
    const item = toBusinessItem(row, optionsByListing.get(row.listing_id) ?? []);
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
  if (!data) return null;
  const row = data as unknown as BusinessRow;
  const options = (await getOpportunityOptionsForListings([row.listing_id])).get(row.listing_id) ?? [];
  return toBusinessItem(row, options);
}

// ---------------------------------------------------------------- explore (V2)

export interface ExploreItem {
  listingId: string;
  opportunity: PresentableOpportunity;
  place: BusinessOpportunityPlace | null;
  event: BusinessOpportunityEvent | null;
  /** This Business's own recipient row for the listing, when one exists —
   * the card then opens that relationship instead. */
  linkedRecipientId: string | null;
  /** Pass 3 — this listing's structured Options (+Components). Empty for a
   * legacy-unclassified listing. */
  options: AdminOpportunityOption[];
}

type ExploreRow = BusinessOpportunityListing & {
  visibility?: string | null;
  location: BusinessOpportunityPlace | BusinessOpportunityPlace[] | null;
  event: BusinessOpportunityEvent | BusinessOpportunityEvent[] | null;
};

const EXPLORE_COLUMNS = `${BUSINESS_LISTING_COLUMNS}, visibility, ${BUSINESS_CONTEXT_EMBEDS}`;

function toExploreItem(row: ExploreRow, linked: Map<string, string>, options: AdminOpportunityOption[] = []): ExploreItem {
  const loc = one(row.location);
  const ev = one(row.event);
  return {
    listingId: row.id,
    opportunity: toPresentableOpportunity(row),
    place: loc ? { name: loc.name, slug: loc.slug, address: loc.address, city: loc.city, state: loc.state } : null,
    event: ev ? { name: ev.name, slug: ev.slug, start_at: ev.start_at } : null,
    linkedRecipientId: linked.get(row.id) ?? null,
    options,
  };
}

async function linkedRecipients(admin: ReturnType<typeof requireAdminClient>, businessId: string, listingIds: string[]) {
  if (listingIds.length === 0) return new Map<string, string>();
  const { data } = await admin.from("opportunity_recipients").select("id, listing_id").eq("business_id", businessId).in("listing_id", listingIds);
  return new Map(((data ?? []) as { id: string; listing_id: string }[]).map((r) => [r.listing_id, r.id]));
}

/** Explore inventory for one Business: ONLY listings explicitly
 * discoverable, open and not past their deadline (isExplorable), filtered
 * server-side. Business-safe columns only. `available` is false when the
 * discoverability column doesn't exist yet (migration not applied) — the
 * page then shows its empty state instead of failing. */
export async function getExploreItems(businessId: string, filters: ExploreFilters): Promise<{ available: boolean; items: ExploreItem[] }> {
  await requireBusinessMember(businessId);
  const admin = requireAdminClient();
  let query = admin
    .from("opportunity_listings")
    .select(EXPLORE_COLUMNS)
    .eq("visibility", "discoverable")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(100);
  if (filters.type) query = query.eq("opportunity_type", filters.type);
  const { data, error } = await query;
  if (error || !data) return { available: false, items: [] };
  const now = new Date();
  const rows = (data as unknown as ExploreRow[]).filter(
    (r) => isExplorable({ visibility: r.visibility, status: r.status, response_deadline: r.response_deadline }, now) && matchesExploreFilters({ ...r, location: one(r.location) }, filters, now)
  );
  const optionsByListing = await getOpportunityOptionsForListings(rows.map((r) => r.id));
  const matching = rows.filter((r) =>
    matchesParticipationCost(filters.participationCost, { pricing_mode: r.pricing_mode, price_cents: r.price_cents }, optionsByListing.get(r.id) ?? [])
  );
  const linked = await linkedRecipients(admin, businessId, matching.map((r) => r.id));
  return { available: true, items: matching.map((r) => toExploreItem(r, linked, optionsByListing.get(r.id) ?? [])) };
}

/** One explorable listing, or null when it isn't explorable (private,
 * not open, past deadline, missing). */
export async function getExploreItem(businessId: string, listingId: string): Promise<ExploreItem | null> {
  await requireBusinessMember(businessId);
  const admin = requireAdminClient();
  const { data, error } = await admin.from("opportunity_listings").select(EXPLORE_COLUMNS).eq("id", listingId).maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as ExploreRow;
  if (!isExplorable({ visibility: row.visibility, status: row.status, response_deadline: row.response_deadline }, new Date())) return null;
  const options = (await getOpportunityOptionsForListings([row.id])).get(row.id) ?? [];
  return toExploreItem(row, await linkedRecipients(admin, businessId, [row.id]), options);
}

/** "I'm Interested" on an Explore listing the Business has no relationship
 * with yet: owner/manager, real verified user, never Admin Manage-As,
 * listing still explorable, no existing row. Creates the Business's own
 * recipient row as `interested` with a real response record. The unique
 * (listing_id, business_id) key prevents duplicates under a race.
 *
 * Opportunities Cleanup Pass A — sends Admin a best-effort notifyAdmin(),
 * same as respondToOpportunityListing's own response notification. */
export async function expressExploreInterest(args: { businessId: string; listingId: string }): Promise<{ ok: true; recipientId: string } | { ok: false; error: string }> {
  const membership = await requireBusinessMember(args.businessId);
  const userId = await getCurrentUserId();
  if (!userId && !membership.viaAdmin) return { ok: false, error: "Please sign in to respond." };
  const admin = requireAdminClient();
  const item = await getExploreItem(args.businessId, args.listingId);
  const check = checkExploreInterest({ role: membership.role, viaAdmin: membership.viaAdmin, explorable: Boolean(item), alreadyLinked: Boolean(item?.linkedRecipientId) });
  if (!check.ok) return { ok: false, error: check.reason };
  // Temporary single-package policy (see respondToOpportunityListing) —
  // its own fail-closed count, never the display loader (which returns an
  // empty list on a read error).
  const packageCount = await countOpportunityPackages(admin, args.listingId);
  if (packageCount == null) return { ok: false, error: "Couldn't save your interest. Please try again." };
  if (requiresPackageChoice(packageCount)) return { ok: false, error: CHOOSE_PACKAGE_MESSAGE };
  if (!userId || !(await isEmailVerified(admin, userId))) return { ok: false, error: "Verify your email to respond to Opportunities." };
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("opportunity_recipients")
    .insert({ listing_id: args.listingId, business_id: args.businessId, status: "interested", offered_at: now, status_changed_at: now, responded_at: now, responded_by_user_id: userId })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't save your interest. Please try again." };

  const { data: businessRow } = await admin.from("businesses").select("name").eq("id", args.businessId).maybeSingle();
  const businessName = (businessRow as { name: string } | null)?.name ?? "A Business";
  const listingTitle = item?.opportunity.title ?? "an Opportunity";
  await notifyAdmin({
    subject: `${businessName} is interested: ${listingTitle}`,
    heading: "A Business is interested in an Opportunity",
    body: [`${businessName} expressed interest in "${listingTitle}" from Explore.`],
    actionLabel: "Review Opportunity",
    actionUrl: `/admin/opportunities/${args.listingId}#recipient-${data.id}`,
  });

  return { ok: true, recipientId: data.id as string };
}
