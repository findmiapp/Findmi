import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { errorRedirectUrl, isoToLocalDateTime } from "@/lib/admin/form-helpers";
import { requireBusinessMember } from "@/lib/permissions";
import { isAdminSession } from "@/lib/admin/auth";
import { isBusinessPro } from "@/lib/entitlements";
import { getAccountContexts } from "@/lib/accountContext";
import { getPersonalDisplayName } from "@/lib/personalGraph";
import {
  deriveEventIdsWithOccurrenceProjections,
  getCategories,
  getMarketAreaLabel,
  getPastAppearancesForBusiness,
  getProductCategories,
} from "@/lib/data";
import {
  buildNeedsAttentionItems,
  resolveDashboardAppearances,
  canonicalOwnerAppearances,
  type DashboardAppearance,
  type DashboardAppearanceSource,
} from "@/lib/business-dashboard";
import ProInviteCodeEntry from "@/components/ProInviteCodeEntry";
// Visual System Pass 1 — the Business Manager renders its own lightweight
// text-tab navigation directly below (Section 5 of this pass) rather than
// the shared pill-styled TabNav component; TabNavItem's shape (key/label)
// is small enough to define locally instead of importing an unused
// component just for its type, and this way Event/Location Managers
// (TabNav's other two callers) are left completely untouched.
interface TabNavItem {
  key: string;
  label: string;
  icon: NavIconKey;
}
import type { NavIconKey } from "@/lib/navigation";
import { Panel, Row, Stat, Chip, EmptyLine, SectionEyebrow } from "../../owner-ui";
import BusinessAppShell, { sectionForTab } from "./v2/BusinessAppShell";
import BusinessHome from "./v2/BusinessHome";
import MoreMenu from "./v2/MoreMenu";
import OpportunitiesView, { OPPORTUNITY_VIEWS, type OpportunityView } from "./v2/OpportunitiesView";
import { LocationsPresence, PastPresence, PresenceHeader, parsePresenceView } from "./v2/PresenceViews";
import AddToPresence from "./v2/AddToPresence";
import { getLinkedLocationIds, getLocationsForBusiness, getManagedLocationsForUser, isManagingRole } from "@/lib/business-locations";
import { getApplicationsForBusiness, getPendingInvitationsForBusiness, type OpportunityListItem } from "@/lib/opportunities";
import { getBusinessOpportunityItems, getExploreItems } from "@/lib/opportunity-listings";
import { getBusinessGoals } from "@/lib/opportunity-goals";
import { canManageGoals, type GoalRole } from "@/lib/opportunity-goals-domain";
import { isExploreBudget, isExploreTiming, isOpportunityType, type ExploreFilters } from "@/lib/opportunity-listings-domain";
import {
  addAppearanceFromEvent,
  addManualAppearance,
  createMemberProduct,
  removeOwnerAppearance,
  requestReferralPartnerPayout,
  returnProductToCatalog,
  setMemberProductActive,
  submitProductToMarketplace,
  toggleFeaturedAppearance,
  updateBusinessGallery,
  updateBusinessLinks,
  updateBusinessProfile,
  updateMemberProduct,
  updateBusinessHandle,
  updateOwnerAppearance,
} from "../actions";
import { getEntityHandle } from "@/lib/handles";
import MemberImageField from "./MemberImageField";
import MemberGalleryField from "./MemberGalleryField";
import MemberProductActiveButton from "./MemberProductActiveButton";
import AppearanceFieldsForm, { type AppearanceFieldValues } from "./AppearanceFieldsForm";
import type { AccountSearchResult } from "@/components/account/AccountRelationPicker";
import AppearanceEditorDetails from "./AppearanceEditorDetails";
import EventSearchPicker from "./EventSearchPicker";
import RemoveAppearanceButton from "./RemoveAppearanceButton";
import ProductFieldsForm, { type ProductFieldValues } from "./ProductFieldsForm";
import {
  formatAppearanceDateRange,
  formatDateShort,
  formatDateShortInZone,
  formatTime,
  formatTimeInZone,
  getTemporalLabel,
} from "@/lib/format";
import { getPublicOrigin } from "@/lib/site-url";
import CopyButton from "@/components/CopyButton";
import { getReferralPartnerByBusinessId } from "@/lib/admin/referral-queries";
import { getBusinessFollowerSummary } from "@/lib/business-followers";
import { sanitizeBusinessInquiryTopics } from "@/lib/business-inquiry-topics";
import CustomerInquiriesForm from "./CustomerInquiriesForm";
import {
  getBusinessOrderDetail,
  getBusinessOrderList,
  getBusinessOrderSummary,
  type BusinessOrderStatusFilter,
} from "@/lib/business-orders";
import { updateOrderItemFulfillment } from "../orders-actions";
import { FULFILLMENT_LABELS } from "@/lib/commerce/quote";
import { getBusinessMarketAssignments } from "@/lib/admin/business-markets";
import {
  DEFAULT_OWNER_PERFORMANCE_RANGE,
  getOwnerBusinessPerformance,
  isOwnerPerformanceRange,
} from "@/lib/analytics/ownerPerformance";
import PerformanceTab from "./PerformanceTab";
import QrCampaignCreator, { QrCampaignContextualPanel } from "./QrCampaignCreator";
import { getBusinessMarketLimit } from "@/lib/entitlements";
import { getPendingMarketRequestForBusiness } from "@/lib/market-requests";
import SupabaseImage from "@/components/SupabaseImage";
import ChevronIcon from "@/components/ChevronIcon";
import type { EventParticipationStatus } from "@/lib/types";
import { imageVariantUrl } from "@/lib/image-variants";

const PARTICIPATION_LABEL: Record<EventParticipationStatus, string> = {
  invited: "Invited",
  applied: "Pending",
  pending: "Pending",
  approved: "Approved",
  declined: "Declined",
};

/** Physical Presence Pass 1 — one shape for every server-seeded value of
 * the Appearance form's Findmi place picker (stored link, Location
 * Manager preselect, validation-error restore): structured city/state so
 * the form can show "City, ST" and clear an un-linked place's snapshot
 * precisely. */
function toPickedLocation(loc: {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  address?: string | null;
}): AccountSearchResult {
  return {
    value: loc.id,
    label: loc.name,
    sublabel: [loc.city, loc.state].filter(Boolean).join(", ") || undefined,
    city: loc.city,
    state: loc.state,
    address: loc.address ?? null,
  };
}

/** Launch Stability pass — QR Appearance Label Disambiguation (P2). Bare
 * a.title alone (the previous label at every QR-picker call site below)
 * renders every recurring appearance — e.g. several "A Cup of Love" dates
 * at the same or different venues — as identical, indistinguishable
 * <option> text, unusable for national/recurring activations (see the QR
 * audit). Every field read here is already fetched by the same
 * appearances query every caller already reads from — presentation-only,
 * no new query. Date is always included (mandatory). Venue/city is
 * appended only while the whole label stays reasonably short for a native
 * <select>, which can't wrap or truncate its own option text — falls back
 * to "Title — Date · City" (dropping venue name/state) once the fuller
 * form would run long. */
function buildAppearanceQrLabel(a: {
  title: string;
  start_at: string;
  venue_name: string | null;
  city: string | null;
  state: string | null;
}): string {
  const date = formatDateShort(a.start_at);
  const full = [a.venue_name, [a.city, a.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  const withFull = `${a.title} — ${date}${full ? ` · ${full}` : ""}`;
  if (withFull.length <= 60) return withFull;
  const short = a.city ?? a.venue_name;
  return `${a.title} — ${date}${short ? ` · ${short}` : ""}`;
}

export const metadata: Metadata = {
  title: "Manage Business",
  robots: { index: false },
};
// Authenticated, per-user content — must never be statically or
// ISR-cached; every response here is specific to whoever is signed in.
export const dynamic = "force-dynamic";

// Business Category Onboarding Filter pass — Markets & Pop-Ups and
// Packaged Goods stay real rows (existing relationships preserved), just
// no longer offered as a selectable choice here. Slugs only, so this has
// zero effect on the DB, on event/product categories, or on public
// discovery (getCategories() itself is untouched).
const LEGACY_BUSINESS_CATEGORY_SLUGS = new Set(["markets-pop-ups", "packaged-goods"]);

const inputClass =
  "w-full rounded-lg border border-black/10 bg-white px-3 py-2.5 text-input text-primary placeholder:text-subtle focus:border-findmi/50 focus:outline-none focus:ring-2 focus:ring-findmi/15";
const primaryButtonClass =
  "flex h-10 w-full items-center justify-center rounded-lg bg-findmi text-button font-bold text-white transition hover:bg-findmi-600 active:scale-[0.99]";
const cardClass = "rounded-xl border border-black/[0.07] bg-white p-4 sm:p-5";

// Owner Shell V3 — job-oriented primary navigation (replaces the old
// 14-tab inventory-style rail from the Tabbed Business Manager pass).
// Five disciplined destinations answer the owner's real questions
// (Overview: what needs me / Where I'll Be: where can customers find me /
// Analytics: is Findmi helping / Profile: what customers see / Products:
// what I sell), plus Orders only when genuinely relevant (see
// `ordersRelevant` below). Every OTHER previous tab still renders at its
// existing key/route — Gallery and Links & Contact moved INTO Profile as
// their own sections (same Server Actions, same Pro gating, just no
// longer a separate destination); Plan, Findmi Area, and Referral moved
// into the new secondary "settings" destination; Followers moved into
// Analytics as a compact Audience section. Legacy tab keys
// (gallery/links/plan/market/followers) redirect to their new canonical
// destination (LEGACY_TAB_REDIRECTS below) rather than rendering a
// second, competing copy of the same UI. Customer Inquiries keeps
// rendering at its existing key unchanged — real, live configuration
// that isn't being consolidated this pass — just no longer listed as a
// primary pill; Settings links to it so it isn't orphaned. Opportunities
// (Unified Inbox V3) no longer renders its own copy here at all — that
// key now redirects straight to the canonical Inbox's Opportunities
// filter (see the redirect below), since it was a genuine duplicate of
// what Inbox already shows.
const PRIMARY_TABS: TabNavItem[] = [
  { key: "overview", label: "Overview", icon: "home" },
  { key: "findmi-here", label: "Findmi Here", icon: "calendar" },
  // Performance -> Analytics (owner-facing rename only — see
  // lib/analytics/ownerPerformance.ts's own doc comment; the tab KEY
  // stays "performance" on purpose so every existing ?tab=performance
  // link/bookmark keeps working).
  { key: "performance", label: "Analytics", icon: "target" },
  // First-Class QR Campaigns — a real Business Manager destination of its
  // own (create/manage/reopen trackable QR codes), deliberately separate
  // from Analytics/Performance (measuring what they did). Placed right
  // after Analytics so the two related-but-distinct jobs sit together in
  // this desktop-sidebar ordering. Mobile's own primary-row placement is
  // independent of this array position — see MOBILE_PRIMARY_KEYS below,
  // which puts QR Campaigns (not Analytics) in mobile's 3rd always-
  // tappable slot.
  { key: "qr", label: "QR Campaigns", icon: "pin" },
  { key: "profile", label: "Profile", icon: "person" },
  { key: "products", label: "Products", icon: "tag" },
];
const ORDERS_TAB: TabNavItem = { key: "orders", label: "Orders", icon: "cart" };

// Old tab key -> new canonical destination. A visit to any of these
// keys redirects immediately (before any of this page's heavier data
// fetching) rather than rendering a second, now-dead copy of content
// that's been moved elsewhere.
const LEGACY_TAB_REDIRECTS: Record<string, string> = {
  gallery: "profile",
  links: "profile",
  plan: "settings",
  market: "settings",
  followers: "performance",
};

// Every reachable tab key — primary, secondary (settings), Orders, the
// still-independent Customer Inquiries configuration workflow, the
// referral-partner-only tab, and every redirect-only legacy key
// (including "opportunities" itself now — Unified Inbox V3) so the
// param is recognized long enough to redirect rather than silently
// falling back to Overview.
const VALID_TAB_KEYS = new Set<string>([
  ...PRIMARY_TABS.map((t) => t.key),
  "orders",
  "settings",
  "opportunities",
  "inquiries",
  "referral",
  // /account V2 — the More menu (secondary destinations).
  "more",
  ...Object.keys(LEGACY_TAB_REDIRECTS),
]);

const ORDER_STATUS_LABELS: Record<"new" | "confirmed" | "ready" | "fulfilled" | "cancelled", string> = {
  new: "New",
  confirmed: "Confirmed",
  ready: "Ready",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
};

/** MY FINDMI — MANAGE BUSINESS PAGE. The owner-facing editor for a
 * claimed business, calling the existing split Server Actions directly
 * (no update logic duplicated here) — this page only reads what it
 * needs to render each tab's form and hands each submit off entirely to
 * its own action, which already owns every authorization/validation/
 * allowlist/atomicity concern for that section.
 *
 * Free/Pro Entitlement Realignment pass — every core Profile field
 * (name/logo/cover/short description/city/state/postal code/full
 * description/website/Instagram/country/category) is Free now. The
 * separate Gallery + Links & Contact card further down the Profile tab
 * (additional gallery photos, email/phone/Facebook/TikTok/Bulletin) is
 * untouched by this pass and remains Pro-only, same as before. Mirrors
 * updateBusinessProfile/updateBusinessLinks/updateBusinessGallery's own
 * allowlists exactly (../actions.ts), so nothing shown here can submit
 * a field those actions wouldn't already accept. */
export default async function ManageBusinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    tab?: string;
    range?: string;
    saved?: string;
    error?: string;
    created?: string;
    pro_payment?: string;
    subscription_checkout?: string;
    editing?: string;
    add_title?: string;
    add_date?: string;
    add_start_time?: string;
    add_end_time?: string;
    add_venue_name?: string;
    add_address?: string;
    add_city?: string;
    add_state?: string;
    add_external_url?: string;
    add_flyer_image_url?: string;
    add_location_id?: string;
    edit_title?: string;
    edit_date?: string;
    edit_start_time?: string;
    edit_end_time?: string;
    edit_venue_name?: string;
    edit_address?: string;
    edit_city?: string;
    edit_state?: string;
    edit_external_url?: string;
    edit_flyer_image_url?: string;
    edit_location_id?: string;
    order?: string;
    order_status?: string;
    add_name?: string;
    add_description?: string;
    add_image_url?: string;
    add_price?: string;
    add_price_label?: string;
    add_product_type?: string;
    add_external_purchase_url?: string;
    add_category_id?: string;
    add_distribution?: string;
    location_id?: string;
    schedule_limit?: string;
    // /account V2 — Presence sub-view and "open the add composer" quick action.
    view?: string;
    compose?: string;
    // /account V2 Pass 2 — Presence -> Locations add panel / remove
    // confirmation / post-action notice.
    add?: string;
    remove?: string;
    location_updated?: string;
    // Pass A — Presence success states.
    request_sent?: string;
    presence_added?: string;
    // Opportunities V2 — Explore filters + goal notices (view= is shared).
    q?: string;
    type?: string;
    where?: string;
    timing?: string;
    budget?: string;
    goal?: string;
  }>;
}) {
  const { id } = await params;
  const rawSearchParams = await searchParams;
  const {
    tab: tabParam,
    range: rangeParam,
    saved,
    error,
    created,
    order: openOrderId,
    order_status: orderStatusFilter,
    pro_payment: proPayment,
    subscription_checkout: subscriptionCheckout,
    editing,
    location_id: preselectedLocationId,
    schedule_limit: scheduleLimitParam,
    view: viewParam,
    compose: composeParam,
    add: addParam,
    remove: removeParam,
    location_updated: locationUpdated,
    request_sent: requestSent,
    presence_added: presenceAdded,
    add_title,
    add_date,
    add_start_time,
    add_end_time,
    add_venue_name,
    add_address,
    add_city,
    add_state,
    add_external_url,
    add_flyer_image_url,
    add_location_id,
    edit_title,
    edit_date,
    edit_start_time,
    edit_end_time,
    edit_venue_name,
    edit_address,
    edit_city,
    edit_state,
    edit_external_url,
    edit_flyer_image_url,
    edit_location_id,
    add_name: addProductName,
    add_description: addProductDescription,
    add_image_url: addProductImageUrl,
    add_price: addProductPrice,
    add_price_label: addProductPriceLabel,
    add_product_type: addProductType,
    add_external_purchase_url: addProductExternalUrl,
    add_category_id: addProductCategoryId,
    add_distribution: addProductDistribution,
  } = rawSearchParams;
  const tab = tabParam && VALID_TAB_KEYS.has(tabParam) ? tabParam : "overview";

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Same defense-in-depth re-check every other /account Server
  // Component/Action already does — Admin Manage-As Foundation extends it
  // to also let a founder admin session through with NO personal Supabase
  // Auth session at all (requireBusinessMember() below is still the real
  // authorization for both paths; this is only what decides whether to
  // bounce to /login before ever reaching it).
  if (!user && !(await isAdminSession())) {
    redirect(`/login?next=${encodeURIComponent(`/account/business/${id}`)}`);
  }

  // Real, session-scoped authorization — never trusts anything from the
  // URL beyond the id itself. Same requireBusinessMember() foundation
  // every split action uses; a visitor with no business_members row for
  // this business (and no admin session — see lib/permissions.ts) never
  // sees the form at all, existing account error pattern (an ?error=
  // banner on the account home, same shape every other /account page
  // already uses).
  let isAdminElevated = false;
  let membershipRole: string | null = null;
  try {
    const membership = await requireBusinessMember(id);
    isAdminElevated = Boolean(membership.viaAdmin);
    membershipRole = membership.role;
  } catch (err) {
    const message = err instanceof Error ? err.message : "You don't have access to that business.";
    redirect(errorRedirectUrl("/account", message));
  }

  // Only reachable AFTER authorization succeeds above — plan_tier isn't in
  // the public column grant (see restrict_internal_commerce_columns), so
  // it's read via service-role here, same authorize-then-elevate shape as
  // every split action itself.
  const admin = getAdminSupabase();
  if (!admin) redirect(errorRedirectUrl("/account", "Server isn't configured."));

  // Owner Shell V3 — redirect a legacy tab key BEFORE any of the heavier
  // business data fetching below, straight to its new canonical
  // destination (see LEGACY_TAB_REDIRECTS' own doc comment).
  if (LEGACY_TAB_REDIRECTS[tab]) {
    redirect(`/account/business/${id}?tab=${LEGACY_TAB_REDIRECTS[tab]}`);
  }
  // Unified Inbox V3 — this tab's own "Event Invitations"/"My Applications"
  // lists were a genuine duplicate of the canonical Inbox's Opportunities
  // filter (same getPendingInvitationsForBusiness/getApplicationsForBusiness,
  // same respondToEventInvitation action, just business-scoped instead of
  // aggregated). The owner now manages those there instead — this key
  // redirects off-page (not to another tab on this page) so a bookmarked
  // link, the Settings "More" link, and every existing email deep link
  // that still points at ?tab=opportunities all land on the real thing.
  // /account V2 — Opportunities is a primary Business destination again,
  // rendered in-shell from the same loaders/action the Inbox uses (Inbox
  // remains the account-wide view, linked from it).

  // Owner Shell V3 — persistent Business switcher (Section 12 of this
  // pass). Only queried for a real authenticated owner: a pure admin-
  // elevated session (no personal Supabase Auth user) doesn't "manage"
  // Businesses via business_members at all, so there is no list to
  // switch between and the switcher simply never renders for it — admin
  // authorization/access is otherwise completely untouched. Same RLS-
  // scoped query shape /account and /account/business already use
  // (`.eq("user_id", user.id)`, plain `supabase` client, never `admin`),
  // so this can never surface a Business the visitor doesn't manage.
  // Global Account Context Switcher V1 — same shared helper every shell
  // uses now, replacing this page's own bespoke {id,name}-only query with
  // the richer slug/logoUrl/role shape the switcher needs. personalLabel
  // is the same canonical display-name helper every other /account page
  // already calls (never the user's email).
  let managedBusinesses: Awaited<ReturnType<typeof getAccountContexts>> = [];
  let personalLabel = "Your Findmi Account";
  if (user) {
    const [contexts, displayName] = await Promise.all([
      getAccountContexts(supabase, user.id),
      getPersonalDisplayName(supabase, user.id),
    ]);
    managedBusinesses = contexts;
    personalLabel = displayName || "Your Findmi Account";
  }

  const [{ data: business }, categories, { data: businessCategoryRows }, { data: galleryRows }, businessHandle] = await Promise.all([
    admin
      .from("businesses")
      .select(
        "id, name, slug, logo_url, cover_image_url, plan_tier, plan_expires_at, publication_status, short_description, description, city, state, postal_code, country, email, phone, website_url, instagram_url, facebook_url, tiktok_url, bulletin_enabled, bulletin_label, bulletin_heading, bulletin_body, bulletin_url, native_inquiries_enabled, accepts_inquiries, inquiry_topics, market_area_id, featured_appearance_id"
      )
      .eq("id", id)
      .maybeSingle(),
    getCategories(),
    // A business may still carry more than one category from before this
    // action's one-category rule existed (admin's own editor allows
    // several) — ordered + limited to 1 so the form simply defaults to
    // one of them rather than erroring; saving collapses it to exactly
    // one via updateBusinessProfile's own atomic set_business_category().
    admin.from("business_categories").select("category_id").eq("business_id", id).order("category_id").limit(1),
    // Existing gallery table (business_images) — same admin query shape
    // (lib/admin/queries.ts's getAdminBusinessById), just read here too so
    // the Pro-only gallery field below has something to preview.
    admin
      .from("business_images")
      .select("url")
      .eq("business_id", id)
      .order("display_order", { ascending: true, nullsFirst: false }),
    getEntityHandle(admin, "business", id),
  ]);
  if (!business) redirect(errorRedirectUrl("/account", "Business not found."));

  const pro = isBusinessPro(business);
  // Business Pro Expiration Enforcement pass — plan_tier still 'pro'/
  // 'pro_seller' while `pro` (ACTIVE entitlement) is false means this
  // business HAD Pro and its term lapsed, as opposed to a business that
  // was never Pro at all. Drives the Plan & Status tab below so a lapsed
  // owner sees "Pro expired" + the real expiration date + a Renew CTA,
  // not the same generic "Unlock your full Findmi presence" copy shown
  // to a business that never upgraded.
  const isExpiredPro = !pro && (business.plan_tier === "pro" || business.plan_tier === "pro_seller");
  const planExpiresAtLabel = business.plan_expires_at
    ? new Date(business.plan_expires_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : null;
  const currentCategoryId = businessCategoryRows?.[0]?.category_id ?? "";
  const galleryImages = (galleryRows ?? []).map((r) => r.url);
  const profileAction = updateBusinessProfile.bind(null, id);

  // QR Campaigns V1 — this Business's own QR campaigns, fetched once,
  // unconditionally (same convention as appearances/products above), so
  // every contextual "Create QR Code"/"View QR Code" affordance on a
  // Product row or Appearance row — regardless of which tab is active —
  // can show whether a campaign already exists for that specific entity
  // without a new query per row. Free-tier reachable: this is NOT gated
  // behind `pro` (see qr-actions.ts's own doc comment on why creation
  // itself is never plan-gated).
  const { data: qrCampaignRows } = await admin
    .from("qr_campaigns")
    .select("id, name, appearance_id, product_id, is_active")
    .eq("business_id", id)
    .order("created_at", { ascending: false });
  // Product Correction — multiple campaigns per entity are the intended
  // product model (e.g. "Table Sign" and "Store Window" both pointing at
  // the same Product), so these are lists to append to, never a single
  // slot to replace. Scan counts reuse the exact same qr_scan/
  // qr_campaign_id shape ownerPerformance.ts/qrCampaignDetail.ts already
  // query — one extra query here, not a new analytics concept.
  const qrCampaignIds = (qrCampaignRows ?? []).map((c) => c.id);
  const { data: qrScanRows } =
    qrCampaignIds.length > 0
      ? await admin.from("analytics_events").select("qr_campaign_id").eq("event_name", "qr_scan").in("qr_campaign_id", qrCampaignIds)
      : { data: [] as { qr_campaign_id: string | null }[] };
  const scansByQrCampaignId = new Map<string, number>();
  for (const r of qrScanRows ?? []) {
    if (!r.qr_campaign_id) continue;
    scansByQrCampaignId.set(r.qr_campaign_id, (scansByQrCampaignId.get(r.qr_campaign_id) ?? 0) + 1);
  }
  const qrCampaignsByAppearanceId = new Map<string, { id: string; name: string; scans: number }[]>();
  const qrCampaignsByProductId = new Map<string, { id: string; name: string; scans: number }[]>();
  for (const c of qrCampaignRows ?? []) {
    const scans = scansByQrCampaignId.get(c.id) ?? 0;
    if (c.appearance_id) {
      const list = qrCampaignsByAppearanceId.get(c.appearance_id) ?? [];
      list.push({ id: c.id, name: c.name, scans });
      qrCampaignsByAppearanceId.set(c.appearance_id, list);
    }
    if (c.product_id) {
      const list = qrCampaignsByProductId.get(c.product_id) ?? [];
      list.push({ id: c.id, name: c.name, scans });
      qrCampaignsByProductId.set(c.product_id, list);
    }
  }
  // First-Class QR Campaigns tab — the flat list of every campaign this
  // Business actually owns (its own qr_campaigns.business_id — Business/
  // Appearance/Product destinations only; Event/Location campaigns have
  // no business_id at all, since that ownership is independent of this
  // Business — see qr-actions.ts). Destination labels are resolved later,
  // once `appearances`/`products` are populated below, rather than
  // duplicating another lookup query here.
  const businessQrCampaignRows = (qrCampaignRows ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    appearanceId: c.appearance_id,
    productId: c.product_id,
    isActive: c.is_active,
    scans: scansByQrCampaignId.get(c.id) ?? 0,
  }));

  // QR Campaigns V1 — the CURRENT USER's own Events/Locations (their real
  // event_members/location_members rows — independent of this Business's
  // own membership, see lib/permissions.ts), offered as additional
  // central-creation destinations on the QR Campaigns panel. Same simple
  // "my own memberships" query account/page.tsx's dashboard already uses.
  const [{ data: ownedEventRows }, { data: ownedLocationRows }] = user
    ? await Promise.all([
        supabase.from("event_members").select("event_id, events(name)").eq("user_id", user.id),
        supabase.from("location_members").select("location_id, locations(name)").eq("user_id", user.id),
      ])
    : [{ data: null }, { data: null }];
  type OwnedEventRow = { event_id: string; events: { name: string } | { name: string }[] | null };
  type OwnedLocationRow = { location_id: string; locations: { name: string } | { name: string }[] | null };
  const qrEligibleEvents = ((ownedEventRows ?? []) as OwnedEventRow[])
    .map((r) => {
      const e = Array.isArray(r.events) ? r.events[0] : r.events;
      return e ? { id: r.event_id, name: e.name } : null;
    })
    .filter((e): e is { id: string; name: string } => Boolean(e));
  const qrEligibleLocations = ((ownedLocationRows ?? []) as OwnedLocationRow[])
    .map((r) => {
      const l = Array.isArray(r.locations) ? r.locations[0] : r.locations;
      return l ? { id: r.location_id, name: l.name } : null;
    })
    .filter((l): l is { id: string; name: string } => Boolean(l));
  const linksAction = updateBusinessLinks.bind(null, id);
  const galleryAction = updateBusinessGallery.bind(null, id);

  // Referral Partner + Discount Foundation — this business's OWN
  // referral-partner record, if an admin has ever set one up for it
  // (unrelated to whether THIS business was itself referred — see
  // referral_attributions, never read here). null for the overwhelming
  // majority of businesses, in which case the whole Referral tab is
  // simply omitted below — never an empty/broken tab.
  const referralPartner = await getReferralPartnerByBusinessId(id);
  // User Identity + Follow Foundation pass — same authorize-then-elevate
  // admin client already established above (requireBusinessMember(id)
  // ran before `admin` was ever created), never a new/looser access path.
  const followerSummary = await getBusinessFollowerSummary(admin, id);
  // Owner-Facing Market Display V1 — read-only for owners in this pass.
  // Reuses the exact same admin-only read helper the Admin → Business →
  // Markets management tab already uses (lib/admin/business-markets.ts),
  // unmodified — its own `.eq("business_id", id)` is what actually scopes
  // this to THIS business's assignments, same as every other read on this
  // page. Same authorize-then-elevate admin client already established
  // above (requireBusinessMember(id) ran before `admin` was ever
  // created). No owner mutation path exists anywhere in this file for
  // business_markets — admin remains the only place that writes it.
  const marketAssignments = await getBusinessMarketAssignments(admin, id);
  const primaryMarket = marketAssignments.find((m) => m.relationship === "primary" && m.active) ?? null;
  const additionalMarkets = marketAssignments.filter((m) => m.relationship === "additional" && m.active);
  const marketLimit = await getBusinessMarketLimit(business);
  const activeMarketCount = (primaryMarket ? 1 : 0) + additionalMarkets.length;
  const overMarketAllowance = marketLimit !== null && activeMarketCount > marketLimit;
  // Consumer Area Picker + Market Requests V1 — a business created via
  // the "request a missing Market" path has no active Primary Market
  // yet; show what was actually requested instead of a bare "Not
  // assigned yet" so the owner isn't left guessing. Never implies an
  // approved Market — see getPendingMarketRequestForBusiness's own note.
  const pendingMarketRequest = primaryMarket ? null : await getPendingMarketRequestForBusiness(admin, id);
  // Launch V2 Pass 1 — this tab no longer renders the legacy thread/reply
  // UI (see Section 13 of that pass's own report: the real, live
  // customer-inquiry inbox is now the canonical Inbox at
  // /account/messages).
  // Business Order Management Overhaul V1 — same authorize-then-elevate
  // admin client; every query inside these helpers is itself filtered by
  // business_id, so this business can never see another business's order
  // items even within the same multi-vendor order (see lib/business-orders.ts).
  const validOrderFilters = new Set<BusinessOrderStatusFilter>(["new", "open", "ready", "fulfilled", "cancelled"]);
  const orderStatus = orderStatusFilter && validOrderFilters.has(orderStatusFilter as BusinessOrderStatusFilter)
    ? (orderStatusFilter as BusinessOrderStatusFilter)
    : undefined;
  const orderSummary = await getBusinessOrderSummary(admin, id);
  const orderList = await getBusinessOrderList(admin, id, orderStatus);
  const openOrder = openOrderId ? await getBusinessOrderDetail(admin, openOrderId, id) : null;

  // Owner Shell V3 — Referral moved into Settings; a Business that
  // genuinely has a referral_partners row redirects there (so its old
  // bookmark lands on the real content), while a Business that was never
  // a referral partner keeps the pre-existing safe fallback (silently
  // Overview — "referral" was never a valid destination for it either).
  if (tab === "referral" && referralPartner) {
    redirect(`/account/business/${id}?tab=settings`);
  }
  const activeTab = tab === "referral" ? "overview" : tab;

  // /account V2 — Opportunities (full list on its own view; pending
  // invitation count for Home) and Presence's Past view, each only
  // queried when actually shown. Same existing loaders as the Inbox and
  // the account dashboard — no new query.
  const presenceView = parsePresenceView(viewParam);
  const composeOpen = composeParam === "1";
  // /account V2 Pass 2 — Business Locations, fetched only for that view.
  // Read via the service-role client (already authorized above) so the
  // owner also sees their own pending/archived connected Locations.
  const businessLocationsView =
    activeTab === "findmi-here" && presenceView === "locations"
      ? await (async () => {
          const [page, managed] = await Promise.all([
            getLocationsForBusiness(admin, id),
            user ? getManagedLocationsForUser(admin, user.id) : Promise.resolve([]),
          ]);
          const managedIds = new Set(managed.map((m) => m.id));
          const linkedIds = new Set(page.items.map((l) => l.locationId));
          // Linked ids beyond the first page still mustn't be offered again.
          const alsoLinked = await getLinkedLocationIds(
            admin,
            id,
            managed.filter((m) => !linkedIds.has(m.id)).map((m) => m.id)
          );
          return {
            ...page,
            connectable: managed.filter((m) => !linkedIds.has(m.id) && !alsoLinked.has(m.id)),
            // Admin Manage-As can manage every Location (lib/permissions.ts).
            manageableIds: isAdminElevated ? page.items.map((l) => l.locationId) : page.items.map((l) => l.locationId).filter((lid) => managedIds.has(lid)),
          };
        })()
      : null;
  const [pendingInvitations, businessApplications] =
    activeTab === "opportunities" || activeTab === "overview"
      ? await Promise.all([
          getPendingInvitationsForBusiness(admin, id),
          activeTab === "opportunities" ? getApplicationsForBusiness(admin, id) : Promise.resolve([] as OpportunityListItem[]),
        ])
      : [[] as OpportunityListItem[], [] as OpportunityListItem[]];
  // Business-Facing Opportunities — commercial Opportunities Findmi
  // recommended to THIS Business (separate system from the Event
  // invitations/applications above). Business-safe items only; any member
  // role may view. Also loaded for Home (Opportunities preview).
  const recommendedOpportunities =
    activeTab === "opportunities" || activeTab === "overview" ? await getBusinessOpportunityItems(id) : { active: [], past: [] };
  // Opportunities V2 — the page's four views. Explore and Goals data are
  // only read when that view is open; both tolerate the V2 migration not
  // being applied yet (available: false).
  const opportunityView: OpportunityView =
    activeTab === "opportunities" && OPPORTUNITY_VIEWS.includes(viewParam as OpportunityView) ? (viewParam as OpportunityView) : "for-you";
  const exploreFilters: ExploreFilters = {
    q: rawSearchParams.q?.slice(0, 100) ?? null,
    type: isOpportunityType(rawSearchParams.type) ? rawSearchParams.type : null,
    where: rawSearchParams.where?.slice(0, 100) ?? null,
    timing: isExploreTiming(rawSearchParams.timing) ? rawSearchParams.timing : null,
    budget: isExploreBudget(rawSearchParams.budget) ? rawSearchParams.budget : null,
  };
  const [exploreData, goalsData] =
    activeTab === "opportunities"
      ? await Promise.all([
          opportunityView === "explore" ? getExploreItems(id, exploreFilters) : Promise.resolve(null),
          opportunityView === "goals" ? getBusinessGoals(id) : Promise.resolve(null),
        ])
      : [null, null];
  const canManageOpportunityGoals = canManageGoals((membershipRole ?? "staff") as GoalRole, isAdminElevated);
  const goalManageNote = canManageOpportunityGoals
    ? null
    : isAdminElevated
      ? "Viewing as a Findmi Admin. Goals come from the Business, so they can't be created or changed here."
      : "Only a Business owner or manager can add or change goals.";
  const goalNotice =
    rawSearchParams.goal === "saved"
      ? "Goal saved."
      : rawSearchParams.goal === "paused"
        ? "Goal paused."
        : rawSearchParams.goal === "closed"
          ? "Goal closed."
          : rawSearchParams.goal === "active"
            ? "Goal is active."
            : null;
  const businessOpportunities = [...pendingInvitations, ...businessApplications].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const pastAppearances =
    activeTab === "findmi-here" && presenceView === "past" ? await getPastAppearancesForBusiness(id, 30) : [];

  // Owner Performance V1 — only queried when this tab is actually open
  // (analytics aggregation is heavier than this page's other summary
  // reads, several of which double as Overview data). Same
  // requireBusinessMember(id) authorization above already gates this —
  // getOwnerBusinessPerformance does no authorization of its own, same
  // convention as every other lib/business-*.ts read helper on this page.
  const perfRange = isOwnerPerformanceRange(rangeParam) ? rangeParam : DEFAULT_OWNER_PERFORMANCE_RANGE;
  // Free/Pro Entitlement Realignment pass — Analytics is Pro-only again
  // (it was reachable free before this pass). Gated here too, not just
  // at render, so a Free owner on the deep Performance TAB never triggers
  // the getOwnerBusinessPerformance query at all — same "don't do the
  // paid feature's work for a Free caller" discipline as every other
  // Pro-gated tab on this page. The Performance tab's own render gate
  // below (`pro && performanceData`) is unchanged by the addition below.
  //
  // Business Overview V2 — Overview's Performance Pulse needs the SAME
  // profileViews/impressions/actionsTaken/qr.totalScans numbers this
  // function already computes correctly, for BOTH Free and Pro (Free
  // sees the raw values only; BusinessOverviewV2 never renders
  // `changeLabel`/discoverySources/appearances/products/trend for a Free
  // business). Reusing this one locked, unmodified function — rather
  // than writing a second, parallel "basic" query — is deliberate: it
  // guarantees Overview's numbers can never drift from the Performance
  // tab's own definition of the same metrics.
  // Business Overview V2 — Free vs Pro is never a reporting-PERIOD
  // distinction (Free = reporting, Pro = intelligence — comparisons and
  // discovery breakdown, not a shorter/longer window). Overview has no
  // range selector, so both tiers get the same resolved perfRange
  // (defaults to 30 days, respects ?range= if present) — identical to
  // what the deep Performance tab itself would use.
  const performanceData =
    (activeTab === "performance" && pro) || activeTab === "overview"
      ? await getOwnerBusinessPerformance(admin, id, perfRange)
      : null;

  const requestPayoutAction = referralPartner
    ? requestReferralPartnerPayout.bind(null, id, referralPartner.id)
    : null;

  // Legacy categories stay in the DB for existing relationships but are no
  // longer offered as a new choice — except for a business already
  // assigned to one, so editing this page can never silently drop it.
  const selectableCategories = categories.filter(
    (c) => !LEGACY_BUSINESS_CATEGORY_SLUGS.has(c.slug) || c.id === currentCategoryId
  );

  // FindMi Here — Owner Appearance Manager. Appearance MANAGEMENT (add/
  // connect/edit/remove/withdraw) has always been a Free capability at
  // the Server Action layer. Free Tier Entitlement Reset V1 additionally
  // removed the old DISPLAY-only distinction on the public business
  // profile (business/[slug]/page.tsx — Free and Pro now both show the
  // complete upcoming schedule there); this Business Manager view was
  // never plan-gated at all, on either side. Two separate reads: (1)
  // this business's OWN appearances (its real FindMi Here calendar —
  // see ../actions.ts for the write side), and (2) its official
  // event-roster status (event_businesses/event_occurrence_businesses),
  // purely to label each linked appearance with its separate "Official
  // event participation: …" status — never presented as the
  // appearance's own publication state. Both tables are public-SELECT-
  // readable, so no extra grant is needed to display this business's
  // own rows.
  type OwnAppearance = {
    id: string;
    title: string;
    start_at: string;
    end_at: string;
    venue_name: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    external_url: string | null;
    flyer_image_url: string | null;
    event_id: string | null;
    event_occurrence_id: string | null;
    // Launch Stability pass — needed so the Remove confirmation can
    // correctly warn only when removing this appearance would actually
    // trigger reverseSyncEventParticipation's roster withdrawal (source ===
    // "official_participation" AND event_id set — see that function's own
    // scoping rules in lib/appearance-event-sync.ts).
    source: string | null;
    created_at: string;
    participationStatus: EventParticipationStatus | null;
    // Location Connections pass — the real Findmi Location this
    // standalone appearance is linked to, if any (embedded via the FK for
    // the Edit form's own AccountRelationField default).
    location: { id: string; name: string; city: string | null; state: string | null } | null;
  };
  let appearances: OwnAppearance[] = [];
  // Owner Action UX pass — carries name/date/venue as separate fields
  // (rather than one pre-joined label string) so the searchable Event
  // picker (EventSearchPicker.tsx) can filter/display each independently,
  // per that pass's own "Event Name / Date/time / Venue" requirement.
  let requestOptions: {
    value: string;
    name: string;
    dateLabel?: string;
    venueLabel?: string;
    status: EventParticipationStatus | null;
  }[] = [];
  // Where I'll Be Schedule Scale Bound pass — see below.
  let scheduleHasMore = false;
  // Activity Integrity — Event ids for which this business has per-date
  // official projections (see withoutSupersededEventProjections).
  let eventIdsWithOccurrenceProjections = new Set<string>();
  // Business-Hosted Events V1 — Events this Business HOSTS, sourced ONLY
  // from events.host_business_id (never participation, appearances, a
  // featured flag or organizer_name). Split by the same "has an upcoming
  // (non-cancelled) date" rule the rest of Findmi Here uses; an Event whose
  // dates are all past joins the existing Past list.
  type HostedEventRow = {
    id: string;
    name: string;
    slug: string;
    startAt: string;
    endAt: string | null;
    where: string | null;
    venueName: string | null;
    city: string | null;
    state: string | null;
    upcomingCount: number;
    statusLabel: string | null;
  };
  const hostedUpcoming: HostedEventRow[] = [];
  const hostedPast: HostedEventRow[] = [];
  const hostedEventIds = new Set<string>();
  const SCHEDULE_PAGE_SIZE = 25;
  let scheduleLimitUsed = SCHEDULE_PAGE_SIZE;

  /** Business Manager V4 — root-cause fix for "Where I'll Be shows nothing
   * even though this business clearly has upcoming activity elsewhere in
   * Findmi." An approved event_businesses/event_occurrence_businesses row
   * means this business's participation was approved on the EVENT side —
   * Event→Appearance propagation is what's supposed to keep the
   * `appearances` table in sync with that, but any participation approved
   * through a path/time propagation doesn't cover has no matching
   * `appearances` row, so the raw `appearances` query above (identical to
   * what the account-level unified schedule's own Business-appearance
   * source reads) comes back empty for it — while the SAME occurrence can
   * still surface at the account level via ITS OWN organizer/location
   * sources, which read event_occurrences directly and never depend on an
   * `appearances` row existing at all. This does not write a new
   * `appearances` row (that would be duplicate schedule truth) — it only
   * SURFACES the real, already-approved participation for display,
   * composed entirely from data this block already fetches for the Add
   * picker below (`events`/`occurrences`, plus the already-computed
   * linkedEventIds/linkedOccurrenceIds and the ebStatusRows/eobStatusRows
   * this business's own participation status is already read from). Zero
   * new queries. */
  type EventOnlySchedule = {
    key: string;
    title: string;
    startAt: string;
    endAt: string | null;
    where: string | null;
    href: string | null;
  };
  let eventOnlySchedule: EventOnlySchedule[] = [];
  // Pass A — this business's own requests to join an Event (or one of its
  // dates) that are still awaiting a decision (applied/pending). Shown in
  // Upcoming as "Pending" so a request never looks like it vanished — and
  // never as a confirmed stop: no Appearance exists until approval (the
  // existing participation -> Appearance sync is untouched).
  let pendingSchedule: EventOnlySchedule[] = [];

  {
    const nowIso = new Date().toISOString();
    // Schedule Scale Bound pass — the Where I'll Be list itself is now
    // bounded (a business with 100+ appearances was eagerly rendering a
    // full AppearanceFieldsForm — incl. MemberImageField and
    // AccountRelationField — per row, even collapsed; see the Schedule
    // Scalability audit). Cumulative expansion, not offset paging: each
    // "Load more" click re-requests a bigger schedule_limit from the very
    // start of the list (soonest first, unchanged ordering) rather than a
    // separate next page, so the owner never loses the rows already
    // visible. `schedule_limit` is untrusted input — normalized to a
    // positive multiple of SCHEDULE_PAGE_SIZE and capped well below
    // anything that could recreate an effectively unbounded query.
    const SCHEDULE_LIMIT_CEILING = SCHEDULE_PAGE_SIZE * 10;
    const requestedScheduleLimit = Number.parseInt(scheduleLimitParam ?? "", 10);
    const scheduleLimit =
      Number.isFinite(requestedScheduleLimit) && requestedScheduleLimit > 0
        ? Math.min(Math.ceil(requestedScheduleLimit / SCHEDULE_PAGE_SIZE) * SCHEDULE_PAGE_SIZE, SCHEDULE_LIMIT_CEILING)
        : SCHEDULE_PAGE_SIZE;

    const [{ data: appearanceRows }, { data: linkedIdRows }, { data: ebStatusRows }, { data: eobStatusRows }] = await Promise.all([
      admin
        .from("appearances")
        .select(
          "id, title, start_at, end_at, venue_name, address, city, state, external_url, flyer_image_url, event_id, event_occurrence_id, source, created_at, location:locations(id, name, city, state)"
        )
        .eq("business_id", id)
        .neq("status", "canceled")
        .gt("end_at", nowIso)
        .order("start_at", { ascending: true })
        // Request one row past the page — its presence alone tells us
        // whether "Load more" should show, with no separate count query.
        .limit(scheduleLimit + 1),
      // The Add picker's already-linked-event/occurrence exclusion (below)
      // needs every linked id regardless of the display bound above, or an
      // Event the business already appears at could wrongly reappear as
      // available to add once the schedule list is capped. Two scalar
      // columns only, never rendered — a different cost profile than the
      // bounded row fetch above, so this stays unbounded on purpose (the
      // Add flow itself, and its separate platform-wide Event/Occurrence
      // queries below, are an explicitly out-of-scope concern this pass —
      // see the Schedule Scalability audit).
      admin.from("appearances").select("event_id, event_occurrence_id, source").eq("business_id", id).neq("status", "canceled"),
      admin.from("event_businesses").select("event_id, status").eq("business_id", id),
      admin.from("event_occurrence_businesses").select("occurrence_id, status").eq("business_id", id),
    ]);

    scheduleHasMore = (appearanceRows ?? []).length > scheduleLimit;
    scheduleLimitUsed = scheduleLimit;
    const visibleAppearanceRows = (appearanceRows ?? []).slice(0, scheduleLimit);

    const statusByEvent = new Map((ebStatusRows ?? []).map((r) => [r.event_id, r.status as EventParticipationStatus]));
    const statusByOccurrence = new Map(
      (eobStatusRows ?? []).map((r) => [r.occurrence_id, r.status as EventParticipationStatus])
    );

    appearances = visibleAppearanceRows.map((a) => ({
      ...a,
      location: Array.isArray(a.location) ? (a.location[0] ?? null) : a.location,
      participationStatus: a.event_occurrence_id
        ? (statusByOccurrence.get(a.event_occurrence_id) ?? null)
        : a.event_id
          ? (statusByEvent.get(a.event_id) ?? null)
          : null,
    }));

    // Canonical Activity Normalization pass — same derivation
    // getBusinessFindmiHereActivity (the public Findmi Here feed) now uses
    // on its own rows, so both surfaces agree on which Events have
    // per-date official projections rather than maintaining two copies of
    // this filter.
    eventIdsWithOccurrenceProjections = deriveEventIdsWithOccurrenceProjections(linkedIdRows ?? []);
    const linkedEventIds = new Set((linkedIdRows ?? []).filter((r) => !r.event_occurrence_id).map((r) => r.event_id));
    const linkedOccurrenceIds = new Set((linkedIdRows ?? []).map((r) => r.event_occurrence_id).filter((x): x is string => Boolean(x)));

    // Picker: upcoming, non-demo events not already on this business's
    // own appearance calendar. An event with occurrences is only ever
    // offered per-date (never as a bare event-level option) — a
    // recurring event is always added at the occurrence level.
    const [{ data: events }, { data: occurrences }] = await Promise.all([
      admin.from("events").select("id, name, slug, is_demo, start_at, end_at, venue_name, city, state").eq("is_demo", false),
      admin.from("event_occurrences").select("id, event_id, start_at, timezone").gt("start_at", nowIso).order("start_at"),
    ]);

    const occurrencesByEvent = new Map<string, { id: string; start_at: string; timezone: string }[]>();
    for (const occ of occurrences ?? []) {
      const list = occurrencesByEvent.get(occ.event_id) ?? [];
      list.push(occ);
      occurrencesByEvent.set(occ.event_id, list);
    }

    for (const ev of events ?? []) {
      const venueLabel = [ev.venue_name, [ev.city, ev.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || undefined;
      const evOccurrences = occurrencesByEvent.get(ev.id) ?? [];
      if (evOccurrences.length > 0) {
        for (const occ of evOccurrences) {
          if (linkedOccurrenceIds.has(occ.id)) continue;
          requestOptions.push({
            value: `occ:${ev.id}:${occ.id}`,
            name: ev.name,
            dateLabel: `${formatDateShortInZone(occ.start_at, occ.timezone)} · ${formatTimeInZone(occ.start_at, occ.timezone)}`,
            venueLabel,
            // Launch Stability pass — this business's own participation
            // status for this exact occurrence, if any exists yet (from the
            // same event_occurrence_businesses read already used above for
            // the schedule list's badges). A prior 'declined' status must
            // be visible here, not indistinguishable from a fresh option —
            // see EventSearchPicker's own handling.
            status: statusByOccurrence.get(occ.id) ?? null,
          });
        }
      } else {
        const upcoming = ev.end_at ? new Date(ev.end_at) > new Date() : ev.start_at ? new Date(ev.start_at) > new Date() : false;
        if (!upcoming || linkedEventIds.has(ev.id)) continue;
        requestOptions.push({
          value: `event:${ev.id}`,
          name: ev.name,
          dateLabel: `${formatDateShort(ev.start_at)} · ${formatTime(ev.start_at)}`,
          venueLabel,
          status: statusByEvent.get(ev.id) ?? null,
        });
      }
    }

    // See EventOnlySchedule's own doc comment above — approved
    // participations with no matching `appearances` row, resolved from
    // the exact same events/occurrences already fetched for the picker.
    const eventById = new Map((events ?? []).map((ev) => [ev.id, ev]));
    const approvedOrphanEventIds = (ebStatusRows ?? [])
      // An Event already projected per date (all_dates participation) never
      // gets an extra Event-level placeholder beside those dates.
      .filter((r) => r.status === "approved" && !linkedEventIds.has(r.event_id) && !eventIdsWithOccurrenceProjections.has(r.event_id))
      .map((r) => r.event_id);
    for (const eventId of approvedOrphanEventIds) {
      const ev = eventById.get(eventId);
      if (!ev || !ev.end_at || new Date(ev.end_at) <= new Date()) continue;
      eventOnlySchedule.push({
        key: `event:${ev.id}`,
        title: ev.name,
        startAt: ev.start_at,
        endAt: ev.end_at,
        where: [ev.venue_name, [ev.city, ev.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || null,
        href: `/event/${ev.slug}`,
      });
    }
    const occurrenceById = new Map((occurrences ?? []).map((occ) => [occ.id, occ]));
    const approvedOrphanOccurrenceIds = (eobStatusRows ?? [])
      .filter((r) => r.status === "approved" && !linkedOccurrenceIds.has(r.occurrence_id))
      .map((r) => r.occurrence_id);
    for (const occurrenceId of approvedOrphanOccurrenceIds) {
      const occ = occurrenceById.get(occurrenceId);
      if (!occ) continue;
      const ev = eventById.get(occ.event_id);
      if (!ev) continue;
      eventOnlySchedule.push({
        key: `occurrence:${occurrenceId}`,
        title: ev.name,
        startAt: occ.start_at,
        endAt: null,
        where: [ev.venue_name, [ev.city, ev.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || null,
        href: `/event/${ev.slug}`,
      });
    }
    eventOnlySchedule.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

    const isAwaitingDecision = (status: string) => status === "applied" || status === "pending";
    const venueFor = (ev: { venue_name: string | null; city: string | null; state: string | null }) =>
      [ev.venue_name, [ev.city, ev.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || null;
    for (const r of ebStatusRows ?? []) {
      if (!isAwaitingDecision(r.status)) continue;
      const ev = eventById.get(r.event_id);
      if (!ev || !ev.start_at) continue;
      const endsAt = ev.end_at ?? ev.start_at;
      if (new Date(endsAt) <= new Date()) continue;
      pendingSchedule.push({ key: `pending-event:${ev.id}`, title: ev.name, startAt: ev.start_at, endAt: ev.end_at, where: venueFor(ev), href: `/event/${ev.slug}` });
    }
    for (const r of eobStatusRows ?? []) {
      if (!isAwaitingDecision(r.status)) continue;
      // occurrenceById holds upcoming dates only, so past requests drop out.
      const occ = occurrenceById.get(r.occurrence_id);
      const ev = occ ? eventById.get(occ.event_id) : undefined;
      if (!occ || !ev) continue;
      pendingSchedule.push({ key: `pending-occurrence:${occ.id}`, title: ev.name, startAt: occ.start_at, endAt: null, where: venueFor(ev), href: `/event/${ev.slug}` });
    }
    pendingSchedule.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

    const { data: hostedEvents } = await admin
      .from("events")
      .select("id, name, slug, start_at, end_at, venue_name, city, state, is_demo, publication_status")
      .eq("host_business_id", id)
      .is("trashed_at", null);
    const hostedIds = (hostedEvents ?? []).map((ev) => ev.id as string);
    const { data: hostedOccurrences } = hostedIds.length
      ? await admin
          .from("event_occurrences")
          .select("event_id, start_at, end_at, status, venue_name, city, state, location:locations(name, city, state)")
          .in("event_id", hostedIds)
          .neq("status", "cancelled")
          .order("start_at", { ascending: true })
      : { data: [] };
    type HostedOccurrence = {
      event_id: string;
      start_at: string;
      end_at: string;
      venue_name: string | null;
      city: string | null;
      state: string | null;
      location: { name: string; city: string | null; state: string | null } | { name: string; city: string | null; state: string | null }[] | null;
    };
    const hostedOccByEvent = new Map<string, HostedOccurrence[]>();
    for (const occ of (hostedOccurrences ?? []) as HostedOccurrence[]) {
      const list = hostedOccByEvent.get(occ.event_id) ?? [];
      list.push(occ);
      hostedOccByEvent.set(occ.event_id, list);
    }
    const nowMs = Date.now();
    for (const ev of hostedEvents ?? []) {
      hostedEventIds.add(ev.id);
      const occs = hostedOccByEvent.get(ev.id) ?? [];
      const statusLabel = !ev.is_demo ? null : ev.publication_status === "rejected" ? "Needs Changes" : "In Review";
      const place = (p: { venue_name: string | null; city: string | null; state: string | null }) =>
        [p.venue_name, [p.city, p.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || null;
      if (occs.length > 0) {
        const upcoming = occs.filter((o) => new Date(o.end_at).getTime() > nowMs);
        const pick = upcoming[0] ?? occs[occs.length - 1];
        const loc = Array.isArray(pick.location) ? (pick.location[0] ?? null) : pick.location;
        const row: HostedEventRow = {
          id: ev.id,
          name: ev.name,
          slug: ev.slug,
          startAt: pick.start_at,
          endAt: pick.end_at,
          where: loc ? place({ venue_name: loc.name, city: loc.city, state: loc.state }) : place(pick),
          venueName: loc?.name ?? pick.venue_name,
          city: loc?.city ?? pick.city,
          state: loc?.state ?? pick.state,
          upcomingCount: upcoming.length,
          statusLabel,
        };
        (upcoming.length > 0 ? hostedUpcoming : hostedPast).push(row);
      } else {
        const ends = ev.end_at ?? ev.start_at;
        const row: HostedEventRow = {
          id: ev.id,
          name: ev.name,
          slug: ev.slug,
          startAt: ev.start_at,
          endAt: ev.end_at,
          where: place(ev),
          venueName: ev.venue_name,
          city: ev.city,
          state: ev.state,
          upcomingCount: ends && new Date(ends).getTime() > nowMs ? 1 : 0,
          statusLabel,
        };
        (row.upcomingCount > 0 ? hostedUpcoming : hostedPast).push(row);
      }
    }
    hostedUpcoming.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

    // Read-side dedupe only (no data changes): an Event this Business hosts
    // is represented once, by its Hosting row — its Event-level
    // participation placeholders don't repeat it. Date-level rows stay.
    eventOnlySchedule = eventOnlySchedule.filter((e) => !(e.key.startsWith("event:") && hostedEventIds.has(e.key.slice("event:".length))));
    pendingSchedule = pendingSchedule.filter(
      (e) => !(e.key.startsWith("pending-event:") && hostedEventIds.has(e.key.slice("pending-event:".length)))
    );
  }

  // Command Center V1 — resolves the same appearances array above
  // (standalone AND Event-linked alike, already carrying its
  // participation status) into one flat, presentation-ready view-model,
  // and separately resolves this business's own "Area · Market" label
  // for the header — see lib/business-dashboard.ts for exactly how an
  // Event-linked appearance's geography is derived and why it's a
  // deliberately simpler lookup than the full occurrence-override
  // precedence chain used elsewhere.
  // One canonical, deduped list feeds both Home and Presence.
  const canonicalAppearances = canonicalOwnerAppearances(appearances, eventIdsWithOccurrenceProjections);
  const { appearances: dashboardAppearances, businessGeographyLabel } = await resolveDashboardAppearances(
    admin,
    id,
    // Home's Happening now / Coming up show one card per real-world
    // participation; the Where I'll Be management list keeps every row.
    canonicalAppearances as DashboardAppearanceSource[],
    { primaryMarketId: primaryMarket?.marketId ?? null, marketAreaId: business.market_area_id ?? null }
  );
  // Pass A — the same id-based integrity rule for Presence → Upcoming:
  // a superseded Event-level projection (e.g. Lavazza TABLÌ) isn't listed
  // beside its per-date rows. Display only; records untouched.
  // Business-Hosted Events V1 — a hosted Event's Event-level projection
  // (participation-derived, not one the owner typed in manually) is already
  // represented by its Hosting row; date-level and manual rows stay.
  const presenceAppearances = canonicalAppearances.filter(
    (a) => !(a.event_id && hostedEventIds.has(a.event_id) && !a.event_occurrence_id && a.source !== "manual")
  );
  const todayAppearances = dashboardAppearances.filter((a) => a.isToday);
  const upcomingAppearances = dashboardAppearances.filter((a) => !a.isToday).slice(0, 5);
  // "Materially affects discovery" — the same fields a visitor would
  // actually need to find/trust this business, not every optional field
  // on the Profile tab (e.g. website/social links are never required here).
  const profileIncomplete = !business.logo_url || !business.short_description || !business.city || !business.state || !currentCategoryId;
  const needsAttention = buildNeedsAttentionItems({
    businessId: id,
    hasPrimaryMarket: Boolean(primaryMarket),
    pendingMarketRequestText: pendingMarketRequest?.requestedText ?? null,
    upcomingAppearances: dashboardAppearances,
    newOrderCount: orderSummary.newCount,
    profileIncomplete,
  });

  // Pro Products Foundation pass — Products are genuinely Pro/Pro
  // Seller-only (locked rule), unlike appearances above. Fetched via the
  // service-role client directly (not getProductsForBusiness, which is
  // RLS-scoped to is_active=true only — the public read policy) so the
  // owner can see and manage their own deactivated products too, same
  // "read everything this business owns regardless of public
  // visibility" reasoning the appearances fetch above already uses.
  // product_categories (existing join table, unchanged) read separately
  // to default each product's edit form to its current category.
  //
  // Product Moderation pass — moderation_status/pending_changes now read
  // too, purely for display, and, for a live product with a standing
  // proposal, defaulting the Edit form to the PROPOSED values rather than
  // the live ones (so the owner is editing their draft, not silently
  // reverting it). Nothing here grants any write capability —
  // createMemberProduct/updateMemberProduct (../actions.ts) are the only
  // place moderation_status ever changes, fully server-side, regardless
  // of what this page renders.
  //
  // Products V3 — the old per-axis displayState/marketplaceState string
  // unions (rendered as two separate always-visible badges) are gone;
  // productDisplayStatus (below the component) now derives ONE
  // presentation-only label from moderationStatus/hasPendingChanges/
  // marketplaceStatus/is_active directly, so this type only keeps the
  // real underlying fields, never a pre-rendered display string.
  type OwnProduct = {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    image_url: string | null;
    price: number | null;
    price_label: string | null;
    product_type: "product" | "service";
    external_purchase_url: string | null;
    is_active: boolean;
    categoryId: string;
    moderationStatus: "pending_review" | "live" | "rejected";
    hasPendingChanges: boolean;
    editDefaults: ProductFieldValues;
    // Product Marketplace Distribution pass — SEPARATE from
    // moderationStatus above, never merged with it: this is whether the
    // product may appear in broader FindMi Marketplace/discovery
    // surfaces, not whether its content is approved.
    marketplaceStatus: "catalog_only" | "submitted" | "approved" | "rejected" | "paused";
  };
  let products: OwnProduct[] = [];
  let productCategories: Awaited<ReturnType<typeof getProductCategories>> = [];
  // Free Tier Entitlement Reset V1 — fetched for every business now. The
  // Products tab UI itself was already unlocked for Free (see its own
  // section below); this data fetch had fallen out of sync with that —
  // without it, a Free owner's own newly-created products would never
  // appear in their own management view even though creation itself
  // (createMemberProduct, ../actions.ts) already worked.
  {
    const [{ data: productRows }, fetchedProductCategories] = await Promise.all([
      admin
        .from("products")
        .select(
          "id, name, slug, description, image_url, price, price_label, product_type, external_purchase_url, is_active, moderation_status, pending_changes, marketplace_status"
        )
        .eq("business_id", id)
        // Admin Content Lifecycle V1 — Archive/Trash are admin-only
        // states (no owner-facing action sets them); excluded here so an
        // owner's own product list only ever shows what's actually
        // theirs to manage, and never shows a retired product as if it
        // were a normal active/inactive one with no explanation.
        .is("archived_at", null)
        .is("trashed_at", null)
        .order("is_active", { ascending: false })
        .order("name"),
      getProductCategories(),
    ]);
    productCategories = fetchedProductCategories;

    const productIds = (productRows ?? []).map((p) => p.id);
    const { data: categoryLinks } =
      productIds.length > 0
        ? await admin.from("product_categories").select("product_id, category_id").in("product_id", productIds)
        : { data: [] as { product_id: string; category_id: string }[] };
    const categoryByProduct = new Map((categoryLinks ?? []).map((r) => [r.product_id, r.category_id]));

    products = (productRows ?? []).map((p) => {
      const moderationStatus = (p.moderation_status ?? "live") as "pending_review" | "live" | "rejected";
      const pendingChanges = (p.pending_changes ?? null) as Partial<ProductFieldValues> | null;
      const hasPendingChanges = moderationStatus === "live" && pendingChanges != null;
      const categoryId = categoryByProduct.get(p.id) ?? "";

      // Edit form defaults: the standing proposal's values when one
      // exists (falls back to the live value for any field the proposal
      // didn't include), otherwise the product's own current values.
      // Explicitly gated on hasPendingChanges rather than just
      // `pendingChanges != null` — pending_changes should only ever be
      // set while moderation_status is "live" (see updateMemberProduct),
      // but this stays correct even if that ever weren't true.
      const proposed = hasPendingChanges ? pendingChanges : null;
      const editDefaults: ProductFieldValues = {
        name: proposed?.name ?? p.name,
        description: (proposed?.description ?? p.description) ?? "",
        image_url: p.image_url,
        price: String((proposed?.price ?? p.price) ?? ""),
        price_label: (proposed?.price_label ?? p.price_label) ?? "",
        product_type: (proposed?.product_type ?? p.product_type) as "product" | "service",
        external_purchase_url: (proposed?.external_purchase_url ?? p.external_purchase_url) ?? "",
        category_id: (proposed ? (proposed.category_id ?? "") : categoryId) ?? "",
      };

      const marketplaceStatus = (p.marketplace_status ?? "catalog_only") as OwnProduct["marketplaceStatus"];

      return {
        ...p,
        product_type: p.product_type as "product" | "service",
        categoryId,
        moderationStatus,
        hasPendingChanges,
        editDefaults,
        marketplaceStatus,
      };
    });
  }
  const addProduct = createMemberProduct.bind(null, id);

  // Owner Shell V3 — Orders only earns primary-nav visibility when it's
  // genuinely relevant to this Business: capable of selling at all (Pro +
  // at least one product) or already has real order history. Uses only
  // data this page already fetched above — no new query, no new
  // entitlement. ?tab=orders itself keeps working regardless (Section 13
  // — existing deep links must remain functional); this only controls
  // whether the primary pill row bothers showing it.
  const ordersRelevant =
    pro &&
    (products.length > 0 ||
      orderSummary.newCount + orderSummary.openCount + orderSummary.readyCount + orderSummary.fulfilledCount + orderSummary.cancelledCount > 0);


  const addFromEvent = addAppearanceFromEvent.bind(null, id);
  const addManual = addManualAppearance.bind(null, id);

  // Location Manager's "+ Add Appearance Here" links here with
  // ?location_id=<location>, so the picker below arrives pre-selected
  // instead of asking the owner to re-search a name they just came from.
  // Looked up server-side (never trusts a client-posted name/city) — the
  // same admin client this page already reads Location context with
  // elsewhere. A missing/foreign id just yields no match, same as never
  // having the param at all.
  //
  // Physical Presence Pass 1 — the same server-side lookup also restores
  // a place the owner had picked when a validation error sent them back
  // (add_location_id / edit_location_id, carried by
  // buildAppearanceErrorUrl). Previously the picker came back blank while
  // the snapshot venue text survived, so a corrected resubmit silently
  // saved an appearance that LOOKED linked but wasn't.
  async function lookupPickedLocation(locationId: string | undefined): Promise<AccountSearchResult | null> {
    if (!locationId || !admin) return null;
    const { data: loc } = await admin
      .from("locations")
      .select("id, name, city, state, address")
      .eq("id", locationId)
      .maybeSingle();
    return loc ? toPickedLocation(loc) : null;
  }
  const [preselectedLocation, editErrorLocation] = await Promise.all([
    lookupPickedLocation(add_location_id ?? preselectedLocationId),
    lookupPickedLocation(editing ? edit_location_id : undefined),
  ]);

  // "Add an Appearance" defaults — blank unless a server-side validation
  // error on THIS form just sent the visitor back here, in which case
  // every add_* value they'd typed is restored exactly as submitted (see
  // buildAppearanceErrorUrl in ../actions.ts). Success clears the form
  // (fresh page load, no add_* params); failure never does.
  const addDefaultValues: AppearanceFieldValues = {
    title: add_title ?? "",
    date: add_date ?? "",
    start_time: add_start_time ?? "",
    end_time: add_end_time ?? "",
    venue_name: add_venue_name ?? "",
    address: add_address ?? "",
    city: add_city ?? "",
    state: add_state ?? "",
    external_url: add_external_url ?? "",
    flyer_image_url: add_flyer_image_url ?? null,
    // Blank on an ordinary fresh load; preselected via ?location_id= from
    // Location Manager, or restored from add_location_id after a
    // validation error (see lookupPickedLocation above).
    location: preselectedLocation,
  };
  // Where I'll Be V3 — whether a rejected manual-add submission just sent
  // the visitor back here (see addDefaultValues above); used to
  // auto-reopen the Add composer and its manual-path disclosure so a
  // validation error never lands behind a closed <details> with the
  // owner's typed input invisible.
  const addHasDraft = Boolean(
    add_title || add_date || add_start_time || add_end_time || add_venue_name || add_address || add_city || add_state || add_external_url || add_flyer_image_url
  );
  // Products V3 — same "reopen the composer on a rejected submission"
  // rule as addHasDraft above, against createMemberProduct's own
  // preservedFields (see ../actions.ts).
  const addProductHasDraft = Boolean(
    addProductName || addProductDescription || addProductImageUrl || addProductPrice || addProductPriceLabel || addProductExternalUrl || addProductCategoryId
  );

  const basePath = `/account/business/${id}`;
  // Schedule Scale Bound pass — "Load more" preserves every current query
  // param (tab, editing, any in-flight add_*/edit_* draft round-trip,
  // etc.) and only overrides schedule_limit, so it never drops owner
  // page state the way a hand-built "?tab=findmi-here&schedule_limit=…"
  // link would.
  const scheduleLoadMoreParams = new URLSearchParams();
  for (const [key, value] of Object.entries(rawSearchParams)) {
    if (typeof value === "string") scheduleLoadMoreParams.set(key, value);
  }
  scheduleLoadMoreParams.set("tab", "findmi-here");
  scheduleLoadMoreParams.set("schedule_limit", String(scheduleLimitUsed + SCHEDULE_PAGE_SIZE));
  const scheduleLoadMoreHref = `${basePath}?${scheduleLoadMoreParams.toString()}`;
  // First-Class QR Campaigns tab — resolves each campaign's destination
  // label now that `appearances`/`products` are populated, reusing the
  // exact same title/name fields the existing qrEligibleAppearances/
  // qrEligibleProducts lookups already read.
  const businessQrCampaigns = businessQrCampaignRows.map((c) => {
    const destinationLabel = c.appearanceId
      ? (appearances.find((a) => a.id === c.appearanceId)?.title ?? "Appearance")
      : c.productId
        ? (products.find((p) => p.id === c.productId)?.name ?? "Product")
        : business.name;
    return { ...c, destinationLabel };
  });

  // /account V2 Home — the performance snapshot reads these already-
  // computed values (no new analytics definition).
  const overviewPulse = {
    profileViews: {
      value: performanceData?.headline.profileViews.value ?? 0,
      changeLabel: performanceData?.headline.profileViews.changeLabel ?? null,
    },
    qrScans: {
      value: performanceData?.qr?.totalScans ?? 0,
      changeLabel: null,
    },
    actionsTaken: {
      value: performanceData?.headline.actionsTaken.value ?? 0,
      changeLabel: performanceData?.headline.actionsTaken.changeLabel ?? null,
    },
    followers: followerSummary.totalCount,
  };

  return (
    <BusinessAppShell
      basePath={basePath}
      business={{ id, name: business.name, slug: business.slug, logoUrl: business.logo_url }}
      pro={pro}
      isExpiredPro={isExpiredPro}
      personalLabel={personalLabel}
      managedBusinesses={managedBusinesses}
      activeSection={sectionForTab(activeTab)}
      isAdminElevated={isAdminElevated}
    >
        {error && (
          <p className="mb-4 max-w-2xl rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-body text-red-700">{error}</p>
        )}
        {saved && !error && (
          <p className="mb-4 max-w-2xl rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-body text-accent">
            Saved.
          </p>
        )}

        {/* ── Overview ─────────────────────────────────────────────── */}
        {/* Command Center V2 — the old Overview was six stacked
            rounded/bordered/shadowed cards (Findmi URL, Today, Needs
            Attention, Upcoming, At a Glance, Quick Actions) — the exact
            "component library demo" reading Analytics' own Visual System
            Pass 1 already moved away from (see PerformanceTab.tsx's
            Section() doc comment). This reuses that same grammar: a
            section title, its content, a thin top divider, the next
            section — no enclosing box except where a boundary is doing
            real work (DashboardAppearanceRow's own per-item border stays,
            since each row is a genuinely distinct, interactive item).
            Sections that would have nothing to say (no items happening
            today, nothing needing attention) are omitted outright rather
            than rendered as an empty card — silence is the successful
            state. At a Glance and Quick Actions are retired entirely:
            their numbers/links were redundant with sections below or with
            the primary Business nav directly above this content. */}
        {activeTab === "overview" && (
          <div className="flex flex-col gap-5">
            {created && (
              <p className="max-w-2xl rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-body text-accent">
                Business created! You can start building your profile below.
              </p>
            )}

            {/* Native Business Onboarding Pass 3 — Stripe redirects here
                immediately after checkout; webhook activation can land
                before or after this render, so this never claims Pro is
                active until `pro` above (read fresh from the database on
                every request) actually confirms it — no false "Pro"
                state shown early. */}
            {proPayment === "success" &&
              (pro ? (
                <p className="max-w-2xl rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-body text-accent">
                  Payment received. Findmi Pro is active, and full Pro tools are unlocked below.
                </p>
              ) : (
                <p className="max-w-2xl rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-body text-accent">
                  Payment received. We&rsquo;re activating Pro, which usually only takes a moment. Refresh this page
                  shortly if it doesn&rsquo;t update automatically.
                </p>
              ))}
            {proPayment === "cancelled" && (
              <p className="max-w-2xl rounded-xl border border-black/10 bg-black/[0.02] px-4 py-3 text-body text-muted">
                Checkout was canceled. Your business is still Free. You can upgrade to Pro anytime.
              </p>
            )}

            {/* Recurring Billing V1 — the recurring Checkout success/cancel
                redirect lands here too, same as the legacy pro_payment
                banner above and for the same reason: the webhook that
                actually mirrors entitlement can land before or after this
                render, so this never claims the subscription is active
                until `pro` (read fresh from the database above) actually
                confirms it. */}
            {subscriptionCheckout === "success" &&
              (pro ? (
                <p className="max-w-2xl rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-body text-accent">
                  Your Findmi subscription is active.
                </p>
              ) : (
                <p className="max-w-2xl rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-body text-accent">
                  Your payment was received. We&rsquo;re activating your Findmi subscription, which usually only
                  takes a moment. Refresh this page shortly if it doesn&rsquo;t update automatically.
                </p>
              ))}
            {subscriptionCheckout === "cancelled" && (
              <p className="max-w-2xl rounded-xl border border-black/10 bg-black/[0.02] px-4 py-3 text-body text-muted">
                Checkout canceled. You were not charged.
              </p>
            )}

            {business.publication_status === "pending_review" && (
              <div className="flex max-w-2xl items-center justify-between gap-3 rounded-lg bg-amber-50 px-3.5 py-2.5">
                <p className="text-body text-amber-900">
                  <span className="font-bold">Pending Review</span>: visible to you now, live in discovery after Findmi reviews it.
                </p>
                {business.slug && (
                  <Link href={`/business/${business.slug}`} className="flex shrink-0 items-center gap-1 text-metadata font-bold text-amber-800 underline underline-offset-2">
                    Preview
                    <ChevronIcon direction="right" className="h-3 w-3" />
                  </Link>
                )}
              </div>
            )}

            {/* Business Overview V2 — command-center recomposition of the
                old 2-region "Today / Needs Attention / Where I'll Be" +
                "Business rail" layout above. Every module's real
                information is preserved, just recomposed: Public status ->
                folded into the identity band; Public page -> "View Public
                Profile"; Products row -> the real Products module below;
                Analytics row -> the Performance Pulse + its own "Full
                analytics ->" link; Today + Needs Attention + Where I'll Be
                -> Upcoming Appearances + Owner Attention. Presentation
                only — every data source is the same already-locked
                function this page already called above (no new
                authorization, no new analytics definition, no new QR
                behavior). Deep management stays exactly where it already
                lives; every module below only links to it. */}
            <BusinessHome
              basePath={basePath}
              businessId={id}
              businessName={business.name}
              pro={pro}
              todayAppearances={todayAppearances}
              upcomingAppearances={upcomingAppearances}
              needsAttention={needsAttention}
              metrics={
                performanceData
                  ? {
                      profileViews: overviewPulse.profileViews,
                      actionsTaken: overviewPulse.actionsTaken,
                      qrScans: overviewPulse.qrScans,
                      followers: overviewPulse.followers,
                    }
                  : null
              }
              metricsRangeLabel={performanceData?.rangeLabel ?? null}
              pendingInvitationCount={pendingInvitations.filter((o) => o.status === "pending").length}
              newOrderCount={orderSummary.newCount}
              businessHandle={businessHandle}
              updateHandleAction={updateBusinessHandle.bind(null, id)}
              opportunityItems={[...recommendedOpportunities.active, ...recommendedOpportunities.past]}
            />
          </div>
        )}

        {/* ── Performance ──────────────────────────────────────────── */}
        {/* Free/Pro Entitlement Realignment pass — Analytics (including
            the Audience section inside PerformanceTab) is Pro-only again,
            same UpgradeLockedTab pattern as every other Pro-gated tab on
            this page. PerformanceTab/getOwnerBusinessPerformance
            themselves are completely unchanged — only this gate moved. */}
        {activeTab === "performance" &&
          (pro && performanceData ? (
            <PerformanceTab
              data={performanceData}
              basePath={basePath}
              range={perfRange}
              businessId={id}
              businessName={business.name}
              businessSlug={business.slug ?? null}
              followerSummary={followerSummary}
              qrEligibleAppearances={appearances.map((a) => ({ id: a.id, name: buildAppearanceQrLabel(a) }))}
              qrEligibleProducts={products.map((p) => ({ id: p.id, name: p.name }))}
              qrEligibleEvents={qrEligibleEvents}
              qrEligibleLocations={qrEligibleLocations}
            />
          ) : (
            <UpgradeLockedTab
              businessId={id}
              tabKey="performance"
              description="Understand how people discover and engage with your business."
              isAdminElevated={isAdminElevated}
            />
          ))}

        {/* ── QR Campaigns ─────────────────────────────────────────── */}
        {/* First-Class QR Campaigns — a direct Business Manager
            destination, not a Performance subsection: creation/management
            is a distinct job from measuring performance. Reuses the exact
            same central QrCampaignCreator (centralOptions mode) the old
            Performance QR panel already used, and the exact same
            /account/qr/[id] detail route every reopen path already links
            to — no parallel QR system, no new analytics. Free-tier
            reachable, unlike Performance itself (see qr-actions.ts's own
            doc comment on why QR creation is never plan-gated). Only
            Business/Appearance/Product campaigns are listed here — this
            Business's own qr_campaigns.business_id. Event/Location
            campaigns have no business_id at all (that ownership is
            independent — event_members/location_members, not
            business_members — see lib/permissions.ts), so an existing
            Event/Location campaign stays reachable from that Event's/
            Location's own manager page, same as before this pass. */}
        {activeTab === "qr" && (
          <div className="flex flex-col gap-4 lg:max-w-2xl">
            <h1 className="font-display text-page-title sm:text-page-title-lg font-bold text-primary">QR Campaigns</h1>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-body text-muted">
                {/* Legacy "Appearance" Copy Pass (#20) — "appearances" is
                    internal Admin/DB ontology, not a term a business owner
                    uses; rewritten to the contextual language Findmi Here
                    already established (where you show up) + events and
                    locations. No change to the QR campaign model itself —
                    a campaign can still target a business, product,
                    Appearance, event, or location row exactly as before. */}
                Create and manage trackable QR codes for your business, products, where you show up, events and locations.
              </p>
              {/* QR Campaigns V2 Pass 2 — the polished Campaign Manager
                  (lifecycle, independent destination, Intelligent Creator)
                  lives at its own dedicated route rather than being inlined
                  into this already very large page. Everything below this
                  link is untouched and stays fully functional as a quick-
                  create/quick-list surface. */}
              <Link href={`/account/business/${id}/qr`} className="flex shrink-0 items-center gap-1 text-metadata font-bold text-accent">
                Open Campaign Manager
                <ChevronIcon direction="right" className="h-3 w-3" />
              </Link>
            </div>

            <QrCampaignCreator
              centralOptions={{
                businessId: id,
                businessName: business.name,
                appearances: appearances.map((a) => ({ id: a.id, name: buildAppearanceQrLabel(a) })),
                products: products.map((p) => ({ id: p.id, name: p.name })),
                events: qrEligibleEvents,
                locations: qrEligibleLocations,
              }}
            />

            <div>
              <SectionEyebrow>Existing Campaigns</SectionEyebrow>
              {businessQrCampaigns.length === 0 ? (
                <div className="mt-2 rounded-lg border border-dashed border-black/10 px-4 py-3">
                  <p className="text-metadata text-subtle">No QR campaigns yet — create one above.</p>
                </div>
              ) : (
                <div className="mt-2 flex flex-col divide-y divide-black/[0.05] rounded-lg border border-black/[0.06] bg-white">
                  {businessQrCampaigns.map((c) => (
                    <Link
                      key={c.id}
                      href={`/account/qr/${c.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-black/[0.015]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-card-title font-semibold text-primary">{c.name}</p>
                        <p className="mt-0.5 truncate text-metadata text-subtle">
                          {c.destinationLabel}
                          {!c.isActive && <span className="ml-1.5 font-semibold text-subtle">· Inactive</span>}
                        </p>
                      </div>
                      <span className="shrink-0 text-right text-microcopy text-muted">{c.scans.toLocaleString()} scans</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Profile ──────────────────────────────────────────────── */}
        {activeTab === "profile" && (
          <div className="flex flex-col gap-4 lg:max-w-5xl">
          <h1 className="font-display text-page-title sm:text-page-title-lg font-bold text-primary">Business Profile</h1>
          <Panel title="Business Identity" meta={<span className="text-metadata text-subtle">What customers see</span>}>
            <form action={profileAction} className="flex flex-col gap-4">
              <label className="block">
                <span className="mb-1.5 block text-body font-medium text-primary">Business name</span>
                <input type="text" name="name" required defaultValue={business.name} className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-body font-medium text-primary">Category</span>
                <select name="category_id" required defaultValue={currentCategoryId} className={inputClass}>
                  <option value="" disabled>
                    Choose a category…
                  </option>
                  {selectableCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-body font-medium text-primary">Short description</span>
                <textarea
                  name="short_description"
                  rows={3}
                  defaultValue={business.short_description ?? ""}
                  className={inputClass}
                />
              </label>
              <MemberImageField businessId={id} label="Logo" name="logo_url" defaultValue={business.logo_url} />
              <MemberImageField
                businessId={id}
                label="Cover image"
                name="cover_image_url"
                defaultValue={business.cover_image_url}
              />

              {/* Free Business Editing Pass 3 — city/state are basic
                  factual location context (locked product rule: Free =
                  ownership + accurate basic presence), so they're always
                  rendered here regardless of plan. PROFILE_FREE_COLUMNS
                  in ../actions.ts is what actually authorizes the write
                  for both tiers — this is just presentation following
                  that. */}
              <p className="mt-2 text-label font-bold uppercase text-subtle">Location</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1.5 block text-body font-medium text-primary">City</span>
                  <input type="text" name="city" defaultValue={business.city ?? ""} className={inputClass} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-body font-medium text-primary">State</span>
                  <input type="text" name="state" defaultValue={business.state ?? ""} className={inputClass} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-body font-medium text-primary">ZIP Code</span>
                  <input type="text" name="postal_code" defaultValue={business.postal_code ?? ""} className={inputClass} />
                </label>
              </div>
              {/* Free/Pro Entitlement Realignment pass — the previous
                  "City, state and ZIP appear on your public page with
                  Findmi Pro." caption is removed: BusinessPublicView now
                  renders location for both tiers (see that file's own
                  entitlement pass), so the caption is no longer true for
                  either plan and would only mislead a Free owner into
                  thinking these fields still need Pro to reach their
                  public page. */}

              {/* Free Basic Profile Editing pass — About/description,
                  Website and Instagram are genuine Free profile fields
                  now (PROFILE_FREE_COLUMNS in ../actions.ts authorizes
                  the write for both tiers), so they're always rendered
                  here regardless of plan, same presentation-follows-
                  authorization pattern as city/state/ZIP above. Moved
                  out of the Links & Contact tab (Website/Instagram used
                  to live there, entirely Pro-gated) since Profile is now
                  their one home for every tier. */}
              <p className="mt-2 text-label font-bold uppercase text-subtle">About</p>
              <label className="block">
                <span className="mb-1.5 block text-body font-medium text-primary">About / full description</span>
                <textarea
                  name="description"
                  rows={5}
                  defaultValue={business.description ?? ""}
                  className={inputClass}
                />
              </label>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-body font-medium text-primary">Website</span>
                  <input
                    type="url"
                    name="website_url"
                    defaultValue={business.website_url ?? ""}
                    placeholder="https://…"
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-body font-medium text-primary">Instagram</span>
                  <input
                    type="url"
                    name="instagram_url"
                    defaultValue={business.instagram_url ?? ""}
                    placeholder="https://instagram.com/…"
                    className={inputClass}
                  />
                </label>
              </div>

              {/* Free/Pro Entitlement Realignment pass — country is a
                  regular Free field now (PROFILE_FREE_COLUMNS in
                  ../actions.ts authorizes the write for both tiers), so
                  it's always rendered here regardless of plan, same
                  presentation-follows-authorization pattern as
                  city/state/ZIP/About above. */}
              <label className="block">
                <span className="mb-1.5 block text-body font-medium text-primary">Country</span>
                <input type="text" name="country" defaultValue={business.country ?? ""} className={inputClass} />
              </label>

              <button type="submit" className={`mt-1 ${primaryButtonClass}`}>
                Save Profile
              </button>
            </form>
          </Panel>

          {/* Featured Appearance System — replaces the old FeaturedEventControl
              (pick-an-Event) with a simpler, inline "Feature on profile"
              toggle directly on each eligible row in Where I'll Be below —
              one business, one optional manually-featured Appearance, no
              separate picker/page. */}

          {/* ── Gallery + Links & Contact (Owner Shell V3 — consolidated
              into Profile). Free Tier Entitlement Reset V1 — no longer
              Pro-gated; the UpgradeLockedTab branch that used to cover
              both for Free is removed. Same MemberGalleryField/
              updateBusinessGallery and updateBusinessLinks/Announcement
              forms, both unchanged, now rendered for every business.
              ──────────────────────────────────────────────────────── */}
          {/* Business Manager V4 — Gallery and Contact & Links are already
              two fully separate forms with their own submit actions; at
              desktop they sit side by side as two distinct cards instead
              of stacking full-width, real grouping rather than one long
              scroll — no change to either form's fields or action. */}
          <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-4">
            <Panel title="Gallery">
              <form action={galleryAction} className="flex flex-col gap-4">
                <MemberGalleryField businessId={id} name="gallery_image_url" initialUrls={galleryImages} />
                <button type="submit" className={`mt-1 ${primaryButtonClass}`}>
                  Save Gallery
                </button>
              </form>
            </Panel>
            <Panel title="Contact & Links">
              <form action={linksAction} className="flex flex-col gap-4">
                {/* Free Basic Profile Editing pass — Website/Instagram
                    moved to the Business Basics section above (both tiers
                    edit them there now); this section keeps the rest of
                    Contact & Links: email/phone/Facebook/TikTok/
                    Announcement. Free Tier Entitlement Reset V1 — none of
                    these remain Pro-only; this whole panel now renders
                    for every business (see the doc comment above this
                    grid). */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-body font-medium text-primary">Email</span>
                    <input type="email" name="email" defaultValue={business.email ?? ""} className={inputClass} />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-body font-medium text-primary">Phone</span>
                    <input type="tel" name="phone" defaultValue={business.phone ?? ""} className={inputClass} />
                  </label>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-body font-medium text-primary">Facebook</span>
                    <input
                      type="url"
                      name="facebook_url"
                      defaultValue={business.facebook_url ?? ""}
                      placeholder="https://facebook.com/…"
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-body font-medium text-primary">TikTok</span>
                    <input
                      type="url"
                      name="tiktok_url"
                      defaultValue={business.tiktok_url ?? ""}
                      placeholder="https://tiktok.com/@…"
                      className={inputClass}
                    />
                  </label>
                </div>

                <p className="mt-2 text-label font-bold uppercase text-subtle">Announcement</p>
                {/* Announcement Form Consistency (#16) — when "Show
                    announcement" is off, the fields below used to look
                    just as active/editable as when it's on, which read as
                    "this is permanently on." Pure-CSS has-[] de-emphasis
                    (same :has(:checked) idiom this page already uses on
                    the plan-chooser cards) dims + disables pointer events
                    on the fields instead — no JS, no new client
                    component, and the fields stay in the form submission
                    (never `disabled`) so a draft value typed before
                    toggling off isn't silently dropped on Save. */}
                <div className="rounded-2xl border border-black/10 p-4 has-[input[name=bulletin_enabled]:not(:checked)]:[&_.announcement-fields]:pointer-events-none has-[input[name=bulletin_enabled]:not(:checked)]:[&_.announcement-fields]:opacity-40">
                  <label className="flex items-center gap-2 text-body font-medium text-primary">
                    <input type="checkbox" name="bulletin_enabled" defaultChecked={business.bulletin_enabled} />
                    Show announcement
                  </label>
                  <div className="announcement-fields mt-3 flex flex-col gap-3 transition-opacity">
                    <label className="block">
                      <span className="mb-1.5 block text-body font-medium text-primary">Announcement label</span>
                      <input
                        type="text"
                        name="bulletin_label"
                        defaultValue={business.bulletin_label ?? ""}
                        placeholder="Announcement"
                        className={inputClass}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-body font-medium text-primary">Announcement heading</span>
                      <input
                        type="text"
                        name="bulletin_heading"
                        defaultValue={business.bulletin_heading ?? ""}
                        className={inputClass}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-body font-medium text-primary">Announcement message</span>
                      <textarea
                        name="bulletin_body"
                        rows={3}
                        defaultValue={business.bulletin_body ?? ""}
                        className={inputClass}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-body font-medium text-primary">Announcement link (optional)</span>
                      <input
                        type="text"
                        name="bulletin_url"
                        defaultValue={business.bulletin_url ?? ""}
                        placeholder="https://…"
                        className={inputClass}
                      />
                    </label>
                  </div>
                </div>

                <button type="submit" className={`mt-1 ${primaryButtonClass}`}>
                  Save Links &amp; Contact
                </button>
              </form>

              {/* Business ↔ Public Parity pass — Customer Inquiries is the
                  same "customer engagement" concept as the Announcement
                  above (both control what a visitor can do on the public
                  Business page), but its actual toggle/topics form lives
                  in its own existing tab (?tab=inquiries — see that
                  section's own note on why it stays separate). Previously
                  only reachable via Settings, two hops from Profile, while
                  Bulletin sat right here — this compact status Row closes
                  that gap with zero new logic: same Row primitive
                  Overview's own Business panel already uses for "View →"
                  links, reading the same accepts_inquiries/inquiry_topics
                  the public page's own canInquire check reads. */}
              <div className="border-t border-black/[0.05] px-4 py-3">
                <Row
                  label="Customer Inquiries"
                  value={
                    <span className="inline-flex items-center gap-1">
                      {business.accepts_inquiries && sanitizeBusinessInquiryTopics(business.inquiry_topics).length > 0 ? "Enabled" : "Off"}
                      <ChevronIcon direction="right" className="h-3 w-3" />
                    </span>
                  }
                  href={`${basePath}?tab=inquiries`}
                />
              </div>
            </Panel>
          </div>
          </div>
        )}

        {/* ── Products ─────────────────────────────────────────────── */}
        {/* ── Products ─────────────────────────────────────────────── */}
        {/* Products V3 — same flat visual grammar as Command Center/Where
            I'll Be: no outer card, a top-of-tab + Add composer (never
            requiring a scroll past the whole catalog to reach it), flat
            divided rows, ONE consolidated plain-English status per row
            (see productDisplayStatus below — presentation-only, the real
            moderation_status/marketplace_status two-axis model underneath
            is completely unchanged and still fully detailed inside Edit).
            Business logic untouched: createMemberProduct/
            updateMemberProduct/setMemberProductActive/
            submitProductToMarketplace/returnProductToCatalog are the
            exact same actions as before. */}
        {/* Free/Pro Entitlement Realignment pass — Products is Free now
            (FREE = GET FOUND; a consumer discovery platform needs
            products regardless of plan tier). The `pro` ternary and its
            UpgradeLockedTab branch are removed; Product CRUD itself
            (createMemberProduct/updateMemberProduct/setMemberProductActive/
            submitProductToMarketplace/returnProductToCatalog) is
            completely unchanged, reused as-is for both tiers. */}
        {activeTab === "products" && (
            <div className="flex flex-col gap-4 lg:max-w-5xl">
              {/* Missing Page Hierarchy fix (#8) — same page-title style
                  PerformanceTab.tsx already established for this Business
                  Manager, so Products/QR/Profile read as distinct
                  destinations instead of starting mid-content. */}
              <h1 className="font-display text-page-title sm:text-page-title-lg font-bold text-primary">Products</h1>
              <div className="flex items-center justify-between gap-3">
                <p className="text-body text-muted">
                  {products.length > 0 ? `${products.length} in your catalog` : "Show customers what you make, sell or offer."}
                </p>
              </div>
              <details className="group" open={addProductHasDraft || composeOpen}>
                <summary className="flex h-10 w-fit cursor-pointer list-none items-center justify-center rounded-lg bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600 active:scale-[0.99] [&::-webkit-details-marker]:hidden">
                  <span className="group-open:hidden">{products.length > 0 ? "+ Add Product" : "+ Add Your First Product"}</span>
                  <span className="hidden group-open:inline">Close</span>
                </summary>

                <div className={`mt-3 ${cardClass}`}>
                  <p className="text-card-title font-bold text-primary">Add Product</p>
                  <div className="mt-3">
                    <ProductFieldsForm
                      businessId={id}
                      action={addProduct}
                      categories={productCategories}
                      defaultValues={{
                        name: addProductName ?? "",
                        description: addProductDescription ?? "",
                        image_url: addProductImageUrl ?? null,
                        price: addProductPrice ?? "",
                        price_label: addProductPriceLabel ?? "",
                        product_type: addProductType === "service" ? "service" : "product",
                        external_purchase_url: addProductExternalUrl ?? "",
                        category_id: addProductCategoryId ?? "",
                      }}
                      submitLabel="Add Product"
                      showDistributionChoice
                      distributionDefault={addProductDistribution === "marketplace" ? "marketplace" : "catalog_only"}
                    />
                  </div>
                </div>
              </details>

              {products.length > 0 && (
                <Panel title="Catalog" padded={false}>
                <ul className="flex flex-col divide-y divide-black/[0.06]">
                  {products.map((p) => {
                    const status = productDisplayStatus(p);
                    const priceLine = p.price != null ? `$${p.price}` : p.price_label || null;
                    return (
                      <li key={p.id} className="px-4 py-3 first:pt-0 last:pb-0">
                        <details>
                          {/* Business Manager V4 — a real table-like row at
                              desktop (image, name, price, status, Edit as
                              distinct columns you can scan down), the same
                              compact stacked block as before at mobile —
                              same <details>/<summary> accordion, same edit
                              form underneath, nothing about the
                              interaction changed. */}
                          <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden sm:grid sm:grid-cols-[2.5rem_1fr_6rem_9rem_3rem] sm:items-center sm:gap-4">
                            {p.image_url ? (
                              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-black/10 bg-black/5">
                                {/* eslint-disable-next-line @next/next/no-img-element -- small preview only, a live Storage URL */}
                                <img src={imageVariantUrl(p.image_url, "thumb")} alt="" className="h-full w-full object-cover" />
                              </div>
                            ) : (
                              <div className="hidden h-10 w-10 shrink-0 rounded-lg bg-black/[0.03] sm:block" />
                            )}
                            <div className="min-w-0 flex-1 sm:flex-none">
                              <p className="truncate text-body font-semibold text-primary">{p.name}</p>
                              <p className="mt-0.5 truncate text-metadata text-muted sm:hidden">
                                {priceLine && (
                                  <>
                                    {priceLine}
                                    {" · "}
                                  </>
                                )}
                                <span className={PRODUCT_STATUS_TONE_CLASS[status.tone]}>{status.label}</span>
                              </p>
                            </div>
                            <p className="hidden truncate text-body text-muted sm:block">{priceLine ?? "—"}</p>
                            <p className={`hidden truncate text-metadata sm:block ${PRODUCT_STATUS_TONE_CLASS[status.tone]}`}>{status.label}</p>
                            <span className="shrink-0 text-metadata font-semibold text-accent sm:text-right">Edit</span>
                          </summary>
                          <div className="mt-3 flex flex-col gap-3">
                            {p.moderationStatus === "pending_review" && (
                              <p className="text-metadata text-muted">
                                This product will appear publicly after Findmi approves it.
                              </p>
                            )}
                            {p.hasPendingChanges && (
                              <p className="text-metadata text-muted">
                                Your submitted changes are waiting on Findmi&rsquo;s approval. The version above
                                stays publicly visible until then.
                              </p>
                            )}
                            {p.moderationStatus === "rejected" && (
                              <p className="text-metadata text-muted">
                                Findmi didn&rsquo;t approve this product. Edit and resubmit it for another review.
                              </p>
                            )}

                            {/* Marketplace — Owner-facing transitions only,
                                still fully separate from content moderation
                                above: never offers "approved"/"paused" as
                                something the owner can set directly — those
                                only ever come from admin/products/actions.ts.
                                Flattened from its own nested bordered box
                                into a plain divider section — one composer
                                boundary (the Edit form itself), not two. */}
                            <div className="border-t border-black/10 pt-3">
                              <p className="text-label font-semibold uppercase text-subtle">Marketplace</p>
                              <p className="mt-1 text-metadata text-muted">
                                {p.marketplaceStatus === "catalog_only" && "Shown on your Findmi business profile only."}
                                {p.marketplaceStatus === "submitted" && "Submitted, awaiting Findmi's decision."}
                                {p.marketplaceStatus === "approved" &&
                                  "Approved. May also appear across Findmi Marketplace and discovery."}
                                {p.marketplaceStatus === "rejected" &&
                                  "Not approved for Marketplace, still shown on your business profile."}
                                {p.marketplaceStatus === "paused" &&
                                  "Paused, temporarily out of Marketplace/discovery. Still shown on your business profile."}
                              </p>
                              {(p.marketplaceStatus === "catalog_only" || p.marketplaceStatus === "rejected") && (
                                <form action={submitProductToMarketplace.bind(null, id, p.id)} className="mt-2">
                                  <button type="submit" className="text-metadata font-semibold text-accent hover:underline">
                                    {p.marketplaceStatus === "rejected" ? "Resubmit to Marketplace" : "Submit to Marketplace"}
                                  </button>
                                </form>
                              )}
                              {p.marketplaceStatus === "submitted" && (
                                <form action={returnProductToCatalog.bind(null, id, p.id)} className="mt-2">
                                  <button type="submit" className="text-metadata font-semibold text-muted hover:underline">
                                    Cancel Submission
                                  </button>
                                </form>
                              )}
                              {p.marketplaceStatus === "rejected" && (
                                <form action={returnProductToCatalog.bind(null, id, p.id)} className="mt-1">
                                  <button type="submit" className="text-metadata font-semibold text-subtle hover:underline">
                                    Return to catalog only
                                  </button>
                                </form>
                              )}
                              {(p.marketplaceStatus === "approved" || p.marketplaceStatus === "paused") && (
                                <p className="mt-1 text-metadata text-subtle">
                                  Marketplace placement is managed by Findmi and can&rsquo;t be changed here.
                                </p>
                              )}
                            </div>

                            <ProductFieldsForm
                              businessId={id}
                              action={updateMemberProduct.bind(null, id, p.id)}
                              categories={productCategories}
                              defaultValues={p.editDefaults}
                              submitLabel="Save"
                            />
                          </div>
                        </details>
                        {/* Deactivate/Reactivate — a reversible lifecycle
                            toggle, not a destructive delete (there is no
                            owner-facing delete), so it stays at the row
                            level rather than tucked inside Edit; kept
                            visually secondary to Edit either way. */}
                        <div className="mt-1.5">
                          <MemberProductActiveButton
                            action={setMemberProductActive.bind(null, id, p.id, !p.is_active)}
                            isActive={p.is_active}
                          />
                        </div>
                        {/* QR Campaigns V1 — contextual creation, Free-tier
                            reachable (this tab isn't Pro-gated). Every
                            existing campaign for this Product stays listed
                            and reopenable, AND the creator stays available
                            below it — a Product supports multiple campaigns
                            (Table Sign, Store Window, etc.), never just one. */}
                        <div className="mt-2">
                          <QrCampaignContextualPanel
                            campaigns={qrCampaignsByProductId.get(p.id) ?? []}
                            fixedTarget={{ target: "product", targetId: p.id, label: p.name }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                </Panel>
              )}
            </div>
          )}

        {/* ── Where I'll Be / Findmi Here ─────────────────────────────
            V3 — replaces the old giant enclosing card (+ two equally-
            weighted "OPTION 1 / OPTION 2" forms permanently occupying the
            page below every existing appearance) with the flat visual
            grammar established by Command Center's Coming Up and
            Analytics' Appearance Analytics: no outer card, a flat divided
            list per Appearance, and a single Add entry point pinned to
            the very top — reachable without scrolling past any existing
            record, at any list length. Business logic untouched:
            addFromEvent/addManual/updateOwnerAppearance/
            removeOwnerAppearance are the exact same actions as before. */}
        {/* /account V2 — Presence: Upcoming (the existing Where I'll Be
            management below, unchanged) · Past · Locations. */}
        {activeTab === "findmi-here" && (
          <div className="mb-5">
            <PresenceHeader basePath={basePath} view={presenceView} />
          </div>
        )}
        {activeTab === "findmi-here" && presenceView === "past" && (
          <div className="lg:max-w-3xl">
            <PastPresence
              items={[
                ...pastAppearances
                  // A hosted Event is represented once (its Hosting row
                  // below); its Event-level participation projection is
                  // not repeated. Date-level and manual rows stay.
                  .filter((a) => !(a.event_id && hostedEventIds.has(a.event_id) && !a.event_occurrence_id && a.source !== "manual"))
                  .map((a) => ({
                    id: a.id,
                    title: a.title,
                    startAt: a.start_at,
                    endAt: a.end_at,
                    venueName: a.venue_name,
                    city: a.city,
                    state: a.state,
                    eventSlug: a.event?.slug ?? null,
                  })),
                // Business-Hosted Events V1 — hosted Events whose dates have
                // all passed, at their last date.
                ...hostedPast.map((h) => ({
                  id: `hosted:${h.id}`,
                  title: h.name,
                  startAt: h.startAt,
                  endAt: h.endAt,
                  venueName: h.venueName,
                  city: h.city,
                  state: h.state,
                  eventSlug: h.slug,
                })),
              ].sort((x, y) => new Date(y.startAt).getTime() - new Date(x.startAt).getTime())}
            />
          </div>
        )}
        {activeTab === "findmi-here" && presenceView === "locations" && (
          <LocationsPresence
            basePath={`/account/business/${id}`}
            businessId={id}
            businessName={business.name}
            locations={businessLocationsView?.items ?? []}
            hasMore={businessLocationsView?.hasMore ?? false}
            connectable={businessLocationsView?.connectable ?? []}
            manageableIds={businessLocationsView?.manageableIds ?? []}
            canEdit={isManagingRole(membershipRole)}
            addOpen={addParam === "1"}
            confirmRemoveId={removeParam ?? null}
            notice={locationUpdated ?? null}
          />
        )}
        {activeTab === "findmi-here" && presenceView === "upcoming" && (
          <div className="flex flex-col gap-5 lg:max-w-3xl">
            {/* Business Manager V4 — this is the customer-facing schedule
                workspace for THIS business, not a second copy of Account
                Schedule (which is owner-wide across every managed
                Business/Event/Location). hasAnySchedule now also counts
                eventOnlySchedule — an approved Event participation that
                genuinely has upcoming activity but happens to have no
                `appearances` row shouldn't read as "nothing scheduled." */}
            {/* Pass A — intent-based entry. "+ Add" opens the Host / Go /
                Add a location sheet; "Go somewhere" lands back here with
                compose=1, opening the existing request-to-join composer
                (manual fallback underneath). */}
            <div className="flex flex-col gap-3">
              <p className="text-body text-muted">What you&rsquo;re hosting and where you&rsquo;ll be. This is what customers see on your public Findmi profile.</p>
              <AddToPresence basePath={basePath} businessId={id} initialOpen={addParam === "presence"} />
            </div>

            {requestSent && !error && (
              <p role="status" className="rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-body text-findmi-700">
                <span className="font-semibold">Request sent.</span> It shows below as Pending until the organizer responds.
              </p>
            )}
            {presenceAdded && !error && (
              <p role="status" className="rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-body text-findmi-700">
                Added to Findmi Here.
              </p>
            )}

            {(addHasDraft || composeOpen) && (
              <div id="going-somewhere" className={cardClass}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-card-title font-bold text-primary">Go somewhere</p>
                    <p className="mt-0.5 text-metadata text-muted">Find the event on Findmi and request to join.</p>
                  </div>
                  <Link href={`${basePath}?tab=findmi-here`} className="shrink-0 text-metadata font-semibold text-muted hover:text-primary">
                    Close
                  </Link>
                </div>

                {requestOptions.length > 0 ? (
                  <form action={addFromEvent} className="mt-3">
                    <EventSearchPicker options={requestOptions} />
                  </form>
                ) : (
                  <p className="mt-3 text-body text-muted">No upcoming Findmi events available right now.</p>
                )}

                <AppearanceEditorDetails
                  className="mt-4 border-t border-black/[0.07] pt-3"
                  initialOpen={addHasDraft}
                  summaryClassName="cursor-pointer text-metadata font-semibold text-accent [&::-webkit-details-marker]:hidden"
                  summary="Can’t find it? Add where you’ll be."
                >
                  <div className="mt-3">
                    <AppearanceFieldsForm
                      businessId={id}
                      action={addManual}
                      defaultValues={addDefaultValues}
                      submitLabel="Add"
                    />
                  </div>
                </AppearanceEditorDetails>
              </div>
            )}

            {/* Business-Hosted Events V1 — Events this Business hosts
                (events.host_business_id only), kept apart from Happening
                (where it participates or appears). Each opens the one Event
                Manager with this Business as context. */}
            {hostedUpcoming.length > 0 && (
              <Panel title="Hosting" padded={false}>
                <ul className="flex flex-col divide-y divide-black/[0.05]">
                  {hostedUpcoming.map((h) => (
                    <li key={h.id} className="flex items-center gap-3 px-4 py-3 first:pt-0 last:pb-0">
                      <ScheduleDateBadge iso={h.startAt} live={getTemporalLabel(h.startAt, h.endAt).live} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body font-semibold text-primary">{h.name}</p>
                        <p className="mt-0.5 truncate text-metadata text-muted">
                          {formatTime(h.startAt)}
                          {h.endAt && `–${formatTime(h.endAt)}`}
                          {h.where && ` · ${h.where}`}
                        </p>
                        <p className="mt-0.5 text-microcopy text-subtle">
                          Hosting
                          {h.upcomingCount > 1 && ` · ${h.upcomingCount} upcoming dates`}
                          {h.statusLabel && (
                            <>
                              {" · "}
                              <span className="font-semibold text-findmi-700">{h.statusLabel}</span>
                            </>
                          )}
                        </p>
                      </div>
                      <Link
                        href={`/account/event/${h.id}?business_id=${encodeURIComponent(id)}`}
                        className="shrink-0 text-metadata font-semibold text-accent hover:underline"
                      >
                        Manage
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {hostedUpcoming.length + presenceAppearances.length + eventOnlySchedule.length + pendingSchedule.length === 0 && (
              <Panel padded={false}>
                <EmptyLine>Nothing upcoming yet. Add what you&rsquo;re hosting or where you&rsquo;ll be to show it on your public profile.</EmptyLine>
              </Panel>
            )}

            {/* EXISTING APPEARANCES — a bounded module (a real, coherent
                operating concept — Findmi's own approved rule for when a
                boundary earns its place), flat divided rows inside it. Edit
                is the row's primary/visible action; Remove is demoted
                inside that same existing row-level disclosure (still one
                tap away, never harder to find — just no longer a bright
                red button floating on every row by default). Source
                ("Findmi Event"/"Added by you") and participation status are
                both preserved but quiet — status gets restrained emphasis
                only when it isn't the expected/approved state. */}
            {(presenceAppearances.length > 0 || eventOnlySchedule.length > 0 || pendingSchedule.length > 0) && (
              <Panel title="Happening" padded={false}>
              <ul className="flex flex-col divide-y divide-black/[0.05]">
                {presenceAppearances.map((a) => {
                  const [storedDate, storedStartTime] = isoToLocalDateTime(a.start_at).split("T");
                  const storedEndTime = isoToLocalDateTime(a.end_at).split("T")[1];
                  // A server-side validation error on THIS specific
                  // appearance's edit form takes precedence over its
                  // stored DB values — same "never lose what was typed"
                  // rule as Add, just scoped to the one row that failed.
                  const isEditing = editing === a.id;
                  const editDefaultValues: AppearanceFieldValues = isEditing
                    ? {
                        title: edit_title ?? a.title,
                        date: edit_date ?? storedDate,
                        start_time: edit_start_time ?? storedStartTime,
                        end_time: edit_end_time ?? storedEndTime,
                        venue_name: edit_venue_name ?? a.venue_name ?? "",
                        address: edit_address ?? a.address ?? "",
                        city: edit_city ?? a.city ?? "",
                        state: edit_state ?? a.state ?? "",
                        external_url: edit_external_url ?? a.external_url ?? "",
                        flyer_image_url: edit_flyer_image_url ?? a.flyer_image_url,
                        location: editErrorLocation ?? (a.location ? toPickedLocation(a.location) : null),
                      }
                    : {
                        title: a.title,
                        date: storedDate,
                        start_time: storedStartTime,
                        end_time: storedEndTime,
                        venue_name: a.venue_name ?? "",
                        address: a.address ?? "",
                        city: a.city ?? "",
                        state: a.state ?? "",
                        external_url: a.external_url ?? "",
                        flyer_image_url: a.flyer_image_url,
                        location: a.location ? toPickedLocation(a.location) : null,
                      };
                  const locationLine = [a.venue_name, [a.city, a.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
                  const isLiveNow = getTemporalLabel(a.start_at, a.end_at).live;
                  return (
                    <li key={a.id} className="px-4 py-3 first:pt-0 last:pb-0">
                      <AppearanceEditorDetails
                        initialOpen={isEditing}
                        summaryClassName="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden"
                        summary={
                          <>
                            <ScheduleDateBadge iso={a.start_at} live={isLiveNow} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-body font-semibold text-primary">{a.title}</p>
                              <p className="mt-0.5 truncate text-metadata text-muted">
                                {formatTime(a.start_at)}–{formatTime(a.end_at)}
                                {locationLine && ` · ${locationLine}`}
                              </p>
                              <p className="mt-0.5 text-microcopy text-subtle">
                                {a.event_id ? "Findmi event" : "Added by you"}
                                {/* Physical Presence Pass 1 — management-only
                                    signal: a standalone appearance with no
                                    real location_id won't flow onto any
                                    Location page. Never shown publicly. */}
                                {!a.event_id && !a.location && " · Not linked to a Findmi place"}
                                {a.participationStatus && (
                                  <>
                                    {" · "}
                                    <span className={a.participationStatus === "approved" ? "" : "font-semibold text-findmi-700"}>
                                      {PARTICIPATION_LABEL[a.participationStatus]}
                                    </span>
                                  </>
                                )}
                              </p>
                            </div>
                            <span className="shrink-0 text-metadata font-semibold text-accent">Edit</span>
                          </>
                        }
                      >
                        <div className="mt-3">
                          <AppearanceFieldsForm
                            businessId={id}
                            action={updateOwnerAppearance.bind(null, id, a.id)}
                            defaultValues={editDefaultValues}
                            submitLabel="Save"
                          />
                          <RemoveAppearanceButton
                            action={removeOwnerAppearance.bind(null, id, a.id)}
                            title={a.title}
                            dateLabel={formatDateShort(a.start_at)}
                            venueLabel={locationLine || null}
                            isOfficialParticipation={a.source === "official_participation" && Boolean(a.event_id)}
                          />
                          {/* Featured Appearance System — a simple inline
                              toggle, not a separate picker/page. Featuring
                              this row overwrites the single
                              featured_appearance_id pointer (un-featuring
                              whatever was featured before, if anything);
                              featuring the already-featured row clears it
                              back to null (automatic selection) — the
                              "simple way to clear/change" the spec asks
                              for, with no second control needed. */}
                          <form action={toggleFeaturedAppearance.bind(null, id, a.id)} className="mt-2">
                            <button
                              type="submit"
                              className={`text-metadata font-semibold ${
                                business.featured_appearance_id === a.id ? "text-findmi-700" : "text-accent"
                              }`}
                            >
                              {business.featured_appearance_id === a.id
                                ? "✓ Featured on profile — tap to remove"
                                : "Feature on profile"}
                            </button>
                          </form>
                          {/* QR Campaigns V1 — contextual creation for this
                              Appearance, Free-tier reachable. Existing
                              campaigns stay listed AND the creator stays
                              available — an Appearance supports multiple
                              campaigns, never just one. */}
                          <div className="mt-3">
                            <QrCampaignContextualPanel
                              campaigns={qrCampaignsByAppearanceId.get(a.id) ?? []}
                              fixedTarget={{ target: "appearance", targetId: a.id, label: a.title }}
                            />
                          </div>
                        </div>
                      </AppearanceEditorDetails>
                    </li>
                  );
                })}
                {/* Approved Event participation with no `appearances` row
                    of its own (see EventOnlySchedule's own doc comment) —
                    real, upcoming, customer-facing, just not editable here
                    (there's no Appearance to edit; the Event itself is the
                    source). Same row grammar, "View Event" instead of
                    Edit. */}
                {eventOnlySchedule.map((e) => (
                  <li key={e.key} className="flex items-center gap-3 px-4 py-3 first:pt-0 last:pb-0">
                    <ScheduleDateBadge iso={e.startAt} live={getTemporalLabel(e.startAt, e.endAt).live} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-semibold text-primary">{e.title}</p>
                      <p className="mt-0.5 truncate text-metadata text-muted">
                        {formatTime(e.startAt)}
                        {e.endAt && `–${formatTime(e.endAt)}`}
                        {e.where && ` · ${e.where}`}
                      </p>
                      <p className="mt-0.5 text-microcopy text-subtle">Findmi event · Confirmed</p>
                    </div>
                    {e.href && (
                      <Link href={e.href} className="shrink-0 text-metadata font-semibold text-accent hover:underline">
                        View event
                      </Link>
                    )}
                  </li>
                ))}
                {/* Pass A — requests still awaiting the organizer. Not a
                    confirmed stop and not on the public profile yet. */}
                {pendingSchedule.map((e) => (
                  <li key={e.key} className="flex items-center gap-3 px-4 py-3 first:pt-0 last:pb-0">
                    <ScheduleDateBadge iso={e.startAt} live={false} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-semibold text-primary">{e.title}</p>
                      <p className="mt-0.5 truncate text-metadata text-muted">
                        {formatTime(e.startAt)}
                        {e.where && ` · ${e.where}`}
                      </p>
                      <p className="mt-0.5 text-microcopy text-subtle">
                        <span className="font-semibold text-findmi-700">Pending</span> · Request sent · Not public until approved
                      </p>
                    </div>
                    {e.href && (
                      <Link href={e.href} className="shrink-0 text-metadata font-semibold text-accent hover:underline">
                        View event
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
              </Panel>
            )}

            {/* Schedule Scale Bound pass — a quiet continuation control,
                not a pagination bar: no page numbers, no result count,
                just "there's more" for the businesses that actually have
                more. Invisible for every business under the initial 25 —
                exactly the "essentially zero visible change" this pass
                requires for ordinary vendors. */}
            {scheduleHasMore && (
              <Link
                href={scheduleLoadMoreHref}
                className="text-center text-metadata font-semibold text-accent hover:underline"
              >
                Load more
              </Link>
            )}
          </div>
        )}

        {/* ── Settings (Owner Shell V3, Section 6) — secondary, not a
            primary pill: houses Plan & Status, Findmi Area, and Referral
            (when applicable) inline, plus discoverability links to the
            two still-standalone legacy workflows (Customer Inquiries'
            settings, Event Invitations/Applications) so neither is
            orphaned by their removal from the primary rail. ─────────── */}
        {activeTab === "settings" && (
          <div className="flex flex-col gap-4 lg:max-w-2xl">
          <div className={cardClass}>
            <p className="text-label font-bold uppercase text-subtle">Plan &amp; Status</p>
            <span
              className={`mt-2 inline-flex w-fit items-center rounded-full px-2.5 py-1 text-label font-bold uppercase ${
                pro ? "bg-findmi text-white" : isExpiredPro ? "bg-amber-100 text-amber-800" : "bg-black/[0.06] text-muted"
              }`}
            >
              {pro ? "Pro" : isExpiredPro ? "Pro expired" : "Free"} Plan
            </span>

            {pro ? (
              <p className="mt-3 text-body text-muted">
                Findmi Pro is active{planExpiresAtLabel ? `, expires ${planExpiresAtLabel}` : ""}. Performance
                analytics for your business are unlocked.
              </p>
            ) : (
              <div
                className={`mt-3 rounded-2xl border p-4 sm:p-5 ${
                  isExpiredPro ? "border-amber-200 bg-amber-50" : "border-findmi/20 bg-findmi-50"
                }`}
              >
                {isExpiredPro ? (
                  <>
                    {/* Business Pro Expiration Enforcement pass, updated by
                        the Free Tier Entitlement Reset V1 — a lapsed
                        renewal, not a first-time upgrade: the copy and CTA
                        below say "Renew"/"expired", never "Unlock"/"Upgrade".
                        Your full profile/products/gallery/contact/schedule
                        are Free-tier features now and were never removed by
                        expiration — only Performance analytics locks again. */}
                    <p className="text-card-title font-bold text-primary">
                      Your Findmi Pro plan expired{planExpiresAtLabel ? ` on ${planExpiresAtLabel}` : ""}
                    </p>
                    <p className="mt-1 text-body text-muted">
                      Renew Pro to restore Performance analytics. Your business profile, products, gallery, contact
                      info, and complete upcoming schedule all stay exactly as they are; nothing was removed.
                    </p>
                  </>
                ) : (
                  <>
                    {/* Free Tier Entitlement Reset V1 — the previous copy
                        here ("Unlock your full Findmi presence... business
                        details, contact links, gallery, products, and your
                        complete upcoming schedule") is retired: every one of
                        those is a Free feature now. Pro's real remaining
                        differentiator is Performance/Analytics. */}
                    <p className="text-card-title font-bold text-primary">Understand what&rsquo;s working, and grow it</p>
                    <p className="mt-1 text-body text-muted">
                      Upgrade to Pro for Performance analytics: how people discover and engage with your business.
                    </p>
                  </>
                )}
                {isAdminElevated ? (
                  // Admin Manage-As V1 — starting a Stripe checkout or
                  // redeeming a Pro Invite is identity-sensitive/financial
                  // (see this pass's Step 4), so it stays hidden in Admin
                  // Mode rather than leading to a dead end.
                  <AdminElevatedActionNotice businessId={id} />
                ) : (
                  <>
                    {/* Pro Upgrade — Internal Checkout Handoff Foundation pass: an
                        exact, owned business_id is already known here (this page
                        already required requireBusinessMember(id) above), so this
                        routes through the internal /upgrade/pro handoff instead of
                        straight to the external Tally form. Same route restores an
                        expired Pro business too — startBusinessProCheckout's own
                        eligibility check uses ACTIVE entitlement, not raw
                        plan_tier, so it correctly allows this repurchase. */}
                    <Link
                      href={`/upgrade/pro?business=${id}`}
                      className="mt-3 flex h-11 w-full items-center justify-center rounded-2xl bg-findmi text-label font-bold uppercase text-white transition hover:bg-findmi-600"
                    >
                      {isExpiredPro ? "Renew Pro" : "Upgrade to Pro"}
                    </Link>

                    {/* Pro Invite Sharing UX pass, made consistent across every
                        Pro-gated Business Manager tab by the Pro Invite / Promo
                        Code Consistency pass — same always-visible treatment as
                        UpgradeLockedTab below (Performance/Customer Inquiries,
                        the two tabs still genuinely Pro-only after the Free Tier
                        Entitlement Reset V1), same wording, no longer collapsed
                        behind a summary toggle.
                        Reuses the exact same goToRedeemCode -> /redeem/[code]
                        routing/redemption flow as /join and /account (no separate
                        redemption implementation), with this already-authorized
                        business_id passed through as a hint so /redeem/[code]
                        can skip straight to "Apply Pro to {business.name}"
                        instead of showing a business selector. */}
                    <div className="mt-3">
                      <ProInviteCodeEntry
                        returnTo={`/account/business/${id}?tab=settings`}
                        businessId={id}
                        heading="Have a Pro Invite or Promo Code?"
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── Findmi Area (Owner-Facing Market Display V1, consolidated
              into Settings) ── READ-ONLY for owners — no insert/update/
              delete path onto business_markets exists anywhere in this
              file or in ../actions.ts. Deliberately separate cards so
              Based In (home address), Primary Market (general discovery
              entitlement), and Where I'll Be (actual appearance geography,
              covered in its own destination) are never conflated. */}
          <div className={cardClass}>
            <p className="text-label font-bold uppercase text-subtle">Based In</p>
            <p className="mt-1.5 text-body text-primary">{[business.city, business.state].filter(Boolean).join(", ") || "Not set"}</p>
            <p className="mt-2 text-metadata text-subtle">Your business&rsquo;s home address, separate from your Findmi area below.</p>
          </div>

          <div className={cardClass}>
            <p className="text-label font-bold uppercase text-subtle">Findmi Area</p>
            {primaryMarket ? (
              <p className="mt-1.5 text-body font-semibold text-primary">{primaryMarket.marketName}</p>
            ) : pendingMarketRequest ? (
              <>
                <p className="mt-1.5 text-body font-semibold text-amber-700">
                  Findmi area pending review: {pendingMarketRequest.requestedText}
                </p>
                <p className="mt-2 text-metadata text-subtle">
                  Findmi is reviewing your requested area. Your business is live in the meantime, but won&rsquo;t
                  appear in general area-based discovery until this is approved.
                </p>
              </>
            ) : (
              <>
                <p className="mt-1.5 text-body font-semibold text-muted">No Findmi area selected yet</p>
                <p className="mt-2 text-metadata text-subtle">
                  Your Findmi area determines where your business receives general discovery. Where you&rsquo;ll be
                  (events and pop-ups) can still happen anywhere.
                </p>
                <p className="mt-2 text-metadata text-subtle">Contact Findmi to update this.</p>
              </>
            )}
          </div>

          {additionalMarkets.length > 0 && (
            <div className={cardClass}>
              <p className="text-label font-bold uppercase text-subtle">Additional Findmi Areas</p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {additionalMarkets.map((m) => (
                  <li key={m.id} className="text-body text-primary">
                    {m.marketName}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className={cardClass}>
            <p className="text-label font-bold uppercase text-subtle">Findmi Area Allowance</p>
            <p className="mt-1.5 text-body text-primary">
              {marketLimit === null
                ? `${activeMarketCount} active area${activeMarketCount === 1 ? "" : "s"} / Unlimited`
                : `${activeMarketCount} active / ${marketLimit} allowed`}{" "}
              on your current plan
            </p>
            {overMarketAllowance && (
              <p className="mt-1 text-label font-bold uppercase text-amber-700">Over allowance</p>
            )}
          </div>

          {/* ── Referral (partner-facing, consolidated into Settings —
              only ever shown when this Business actually has a
              referral_partners row) ── */}
          {referralPartner && (
            <div className={cardClass}>
              <p className="text-label font-bold uppercase text-subtle">Referral Program</p>
              <p className="mt-1 text-body text-muted">
                Share your code, and you&rsquo;ll earn a commission when a business you refer upgrades to paid Findmi
                Pro.
              </p>

              {referralPartner.activeCodes.length > 0 ? (
                <div className="mt-4 flex flex-col gap-3">
                  {referralPartner.activeCodes.map((code) => {
                    const referralLink = `${getPublicOrigin()}/join?ref=${code}`;
                    return (
                      <div key={code} className="rounded-2xl bg-findmi-50 p-4">
                        <p className="text-label font-bold uppercase text-accent">Your Referral Code</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <p className="font-mono text-body font-semibold text-primary">{code}</p>
                          <CopyButton
                            value={code}
                            label="Copy Code"
                            className="shrink-0 rounded-xl bg-white px-3 py-1 text-label font-bold uppercase text-accent transition hover:bg-white/70"
                          />
                        </div>
                        <p className="mt-2 break-all font-mono text-metadata text-secondary">{referralLink}</p>
                        <CopyButton
                          value={referralLink}
                          label="Copy Link"
                          className="mt-2 shrink-0 rounded-xl bg-white px-3 py-1 text-label font-bold uppercase text-accent transition hover:bg-white/70"
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-4 text-body text-muted">No active referral code yet. Check back soon.</p>
              )}

              <dl className="mt-4 grid grid-cols-2 gap-4 text-body sm:grid-cols-3">
                <div>
                  <dt className="text-label font-semibold uppercase text-muted">Referred</dt>
                  <dd className="mt-1 text-primary">{referralPartner.referralCount}</dd>
                </div>
                <div>
                  <dt className="text-label font-semibold uppercase text-muted">Free / Paid Pro</dt>
                  <dd className="mt-1 text-primary">
                    {referralPartner.freeReferralCount} / {referralPartner.paidReferralCount}
                  </dd>
                </div>
                <div>
                  <dt className="text-label font-semibold uppercase text-muted">Total Earned</dt>
                  <dd className="mt-1 text-primary">${(referralPartner.earnedCommissionCents / 100).toFixed(2)}</dd>
                </div>
                <div>
                  <dt className="text-label font-semibold uppercase text-muted">Total Paid</dt>
                  <dd className="mt-1 text-primary">${(referralPartner.paidCommissionCents / 100).toFixed(2)}</dd>
                </div>
                <div>
                  <dt className="text-label font-semibold uppercase text-muted">Available Balance</dt>
                  <dd className="mt-1 font-semibold text-accent">
                    ${(referralPartner.availableCommissionCents / 100).toFixed(2)}
                  </dd>
                </div>
              </dl>

              {requestPayoutAction && (
                <form action={requestPayoutAction} className="mt-4">
                  <button
                    type="submit"
                    disabled={referralPartner.availableCommissionCents <= 0}
                    className="flex h-11 w-full items-center justify-center rounded-2xl bg-findmi text-label font-bold uppercase text-white transition hover:bg-findmi-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Request Payout
                    {referralPartner.availableCommissionCents > 0
                      ? ` of $${(referralPartner.availableCommissionCents / 100).toFixed(2)}`
                      : ""}
                  </button>
                </form>
              )}
              <p className="mt-2 text-metadata text-subtle">
                Payouts are reviewed and paid out manually by Findmi. No automatic transfers.
              </p>
            </div>
          )}

          {/* Business Account Correction Pass (#13) — the "More" card that
              used to live here (Customer Inquiries / Event Invitations &
              Applications links) is removed: both are now one tap away
              from every Business V2 screen via the bottom nav's own More
              menu (Tools: Customer inquiries, Inbox — see MoreMenu.tsx),
              so this was a duplicate nav path, not a second real feature.
              Neither underlying page/tab/route was touched — Customer
              Inquiries still lives at its own ?tab=inquiries key exactly
              as before; this only removes the redundant shortcut so Plan
              & Settings stays focused on plan/business settings. */}
          </div>
        )}

        {/* ── Inquiries (native V1) ────────────────────────────────────
            List always shows customer public identity when available
            (never email/phone/user_id) — see getBusinessInquiryList's
            own privacy note. Opening one (?open=<id>) shows the thread +
            reply composer + status selector inline, in this same tab,
            same "?tab=<key>&<extra param>" convention as ?editing=<id>
            elsewhere on this page. */}
        {activeTab === "inquiries" && (
          <div className="flex flex-col gap-3 lg:max-w-2xl">
            {/* Launch V2 Pass 1, Section 13 — this tab is now
                CONFIGURATION ONLY. The legacy list/thread/reply UI that
                used to render below (backed by the `inquiries`/
                `inquiry_messages` tables) is removed: those tables have
                had zero live rows since the canonical Conversations
                system took over every inquiry entry point (see this
                pass's own audit), so that UI could only ever show "No
                inquiries yet" while the REAL live customer inquiries this
                setting controls were only visible at /account/messages
                (the Inbox) — two inquiry surfaces for one real system.
                CustomerInquiriesForm below is untouched: same Accept
                Inquiries toggle, same Inquiry Types, same accepts_inquiries/
                inquiry_topics columns, same Pro gate, same public Inquire
                behavior. */}
            {pro ? (
              <CustomerInquiriesForm
                businessId={id}
                defaultAcceptsInquiries={business.accepts_inquiries}
                defaultTopics={sanitizeBusinessInquiryTopics(business.inquiry_topics)}
              />
            ) : (
              <UpgradeLockedTab
                businessId={id}
                tabKey="inquiries"
                description="Let customers inquire about your business directly through Findmi."
                isAdminElevated={isAdminElevated}
              />
            )}

            <Link
              href="/account/messages"
              className="flex items-center justify-between gap-3 rounded-2xl border border-black/5 bg-white p-3.5 shadow-sm transition hover:border-black/10"
            >
              <span className="text-body font-semibold text-primary">View customer conversations in your Inbox</span>
              <span className="flex shrink-0 items-center gap-1 text-label font-bold uppercase text-accent">
                Open Inbox
                <ChevronIcon direction="right" className="h-3 w-3" />
              </span>
            </Link>
          </div>
        )}

        {/* ── Orders (Business Order Management Overhaul V1) ──────────
            Every read here comes from lib/business-orders.ts, which is
            itself always filtered by business_id — a multi-vendor order
            can never surface another business's items/revenue/fulfillment
            data in this tab. Payment status is shown read-only; a
            business can only ever move ITS OWN items' fulfillment_status
            and internal_note (updateOrderItemFulfillment), never
            payment_status/total_charged/fees. */}
        {activeTab === "orders" && (
          <div className="flex flex-col gap-3 lg:max-w-3xl">
            {!openOrder && (
              <>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {(
                    [
                      { key: "new", label: "New", count: orderSummary.newCount },
                      { key: "open", label: "Open", count: orderSummary.openCount },
                      { key: "ready", label: "Ready", count: orderSummary.readyCount },
                      { key: "fulfilled", label: "Fulfilled", count: orderSummary.fulfilledCount },
                    ] as const
                  ).map((s) => (
                    <Link
                      key={s.key}
                      href={`${basePath}?tab=orders&order_status=${s.key}`}
                      className={`rounded-2xl border p-3 text-center transition ${
                        orderStatus === s.key ? "border-findmi bg-findmi-50" : "border-black/5 bg-white hover:border-black/10"
                      }`}
                    >
                      <p className="font-display text-stat font-bold text-primary tabular-nums">{s.count}</p>
                      <p className="mt-0.5 text-label font-bold uppercase text-muted">{s.label}</p>
                    </Link>
                  ))}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <Link
                    href={`${basePath}?tab=orders`}
                    className={`rounded-full px-3 py-1.5 text-label font-bold uppercase ${
                      !orderStatus ? "bg-ink text-white" : "bg-black/[0.05] text-muted hover:bg-black/[0.08]"
                    }`}
                  >
                    All
                  </Link>
                  {(["new", "open", "ready", "fulfilled", "cancelled"] as const).map((s) => (
                    <Link
                      key={s}
                      href={`${basePath}?tab=orders&order_status=${s}`}
                      className={`rounded-full px-3 py-1.5 text-label font-bold uppercase ${
                        orderStatus === s ? "bg-ink text-white" : "bg-black/[0.05] text-muted hover:bg-black/[0.08]"
                      }`}
                    >
                      {s === "open" ? "Confirmed" : s.charAt(0).toUpperCase() + s.slice(1)}
                    </Link>
                  ))}
                </div>

                {orderList.length === 0 ? (
                  <p className="rounded-2xl border border-black/5 bg-white p-4 text-body text-muted">No orders yet.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {orderList.map((o) => (
                      <Link
                        key={o.orderId}
                        href={`${basePath}?tab=orders&order=${o.orderId}`}
                        className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white p-3.5 shadow-sm transition hover:border-black/10"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="truncate text-body font-semibold text-primary">#{o.orderNumber}</p>
                            <span className="shrink-0 rounded-full bg-black/[0.05] px-2 py-0.5 text-label font-bold uppercase text-muted">
                              {ORDER_STATUS_LABELS[o.status]}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-metadata text-muted">
                            {o.customerName || o.customerEmail} · {formatDateShort(o.createdAt)}
                          </p>
                          <p className="mt-0.5 truncate text-metadata text-subtle">
                            {o.itemCount} item{o.itemCount === 1 ? "" : "s"} · {o.quantityTotal} qty ·{" "}
                            {o.fulfillmentMethods.map((m) => FULFILLMENT_LABELS[m]).join(", ")}
                          </p>
                        </div>
                        <p className="shrink-0 text-body font-bold text-primary">${o.businessSubtotal.toFixed(2)}</p>
                      </Link>
                    ))}
                  </div>
                )}
              </>
            )}

            {openOrder && (
              <div className={cardClass}>
                <Link
                  href={`${basePath}?tab=orders${orderStatus ? `&order_status=${orderStatus}` : ""}`}
                  className="flex items-center gap-1 text-metadata font-semibold text-muted hover:text-primary"
                >
                  <ChevronIcon direction="left" className="h-3 w-3" />
                  All Orders
                </Link>

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-body font-semibold text-primary">Order #{openOrder.orderNumber}</p>
                  <span className="rounded-full bg-black/[0.05] px-2.5 py-1 text-label font-bold uppercase text-muted">
                    {ORDER_STATUS_LABELS[openOrder.status]}
                  </span>
                </div>
                <p className="mt-0.5 text-metadata text-subtle">
                  {formatDateShort(openOrder.createdAt)} · Payment: {openOrder.paymentStatus}
                </p>

                <div className="mt-3 rounded-2xl bg-black/[0.02] p-3">
                  <p className="text-label font-bold uppercase text-subtle">Customer</p>
                  <p className="mt-1 text-body text-primary">{openOrder.customerName || "—"}</p>
                  <p className="text-metadata text-muted">
                    {[openOrder.customerEmail, openOrder.customerPhone].filter(Boolean).join(" · ")}
                  </p>
                </div>

                <div className="mt-3 flex flex-col gap-3">
                  {openOrder.items.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-black/5 p-3.5">
                      <div className="flex items-start gap-3">
                        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-mist">
                          {item.productImageUrl && (
                            <SupabaseImage src={item.productImageUrl} alt={item.productName} fill sizes="48px" className="object-cover" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-body font-semibold text-primary">{item.productName}</p>
                          <p className="text-metadata text-muted">
                            Qty {item.quantity} × ${item.unitPrice.toFixed(2)} = ${item.lineMerchandiseTotal.toFixed(2)}
                          </p>
                          <p className="mt-0.5 text-metadata text-subtle">{FULFILLMENT_LABELS[item.fulfillmentMethod]}</p>
                          {item.refundedAmount > 0 && (
                            <p className="mt-0.5 text-metadata text-red-600">${item.refundedAmount.toFixed(2)} refunded</p>
                          )}
                        </div>
                      </div>

                      {item.eventContext && (
                        <div className="mt-2.5 rounded-xl bg-findmi-50 p-2.5 text-metadata text-accent">
                          <p className="font-semibold">{item.eventContext.eventName}</p>
                          <p className="mt-0.5">
                            {formatAppearanceDateRange(item.eventContext.startAt, item.eventContext.endAt, item.eventContext.description)}
                          </p>
                          {(item.eventContext.venueName || item.eventContext.address) && (
                            <p className="mt-0.5">
                              {[item.eventContext.venueName, item.eventContext.address, item.eventContext.city, item.eventContext.state]
                                .filter(Boolean)
                                .join(", ")}
                            </p>
                          )}
                        </div>
                      )}

                      <form action={updateOrderItemFulfillment.bind(null, id, item.id)} className="mt-3 flex flex-wrap items-center gap-2">
                        <input type="hidden" name="order_id" value={openOrder.orderId} />
                        <select
                          name="fulfillment_status"
                          defaultValue={item.fulfillmentStatus}
                          className="rounded-xl border border-black/10 bg-white px-3 py-2 text-input text-primary"
                        >
                          {(["new", "confirmed", "ready", "fulfilled", "cancelled"] as const).map((s) => (
                            <option key={s} value={s}>
                              {ORDER_STATUS_LABELS[s]}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          name="internal_note"
                          defaultValue={item.internalNote ?? ""}
                          placeholder="Internal note (e.g. Hold until 2 PM)"
                          maxLength={500}
                          className={`${inputClass} min-w-[180px] flex-1`}
                        />
                        <button
                          type="submit"
                          className="rounded-xl bg-findmi px-4 py-2 text-label font-bold uppercase text-white transition hover:bg-findmi-600"
                        >
                          Save
                        </button>
                      </form>
                      <p className="mt-1.5 text-microcopy text-subtle">Only visible to you and Findmi admin, never shown to the customer.</p>
                    </div>
                  ))}
                </div>

                <p className="mt-3 text-right text-body font-bold text-primary">Your total: ${openOrder.businessSubtotal.toFixed(2)}</p>
              </div>
            )}
          </div>
        )}

        {/* ── /account V2 — Opportunities (in-shell) ─────────────────── */}
        {activeTab === "opportunities" && (
          <OpportunitiesView
            basePath={basePath}
            businessId={id}
            view={opportunityView}
            opportunities={businessOpportunities}
            recommended={recommendedOpportunities}
            explore={exploreData}
            filters={exploreFilters}
            goals={goalsData}
            canManage={canManageOpportunityGoals}
            manageNote={goalManageNote}
            notice={goalNotice}
          />
        )}

        {/* ── /account V2 — More (secondary destinations) ───────────── */}
        {activeTab === "more" && (
          <MoreMenu basePath={basePath} businessSlug={business.slug} ordersRelevant={ordersRelevant} showReferral={Boolean(referralPartner)} />
        )}

        {/* Referral now renders inside Settings (?tab=settings) —
            ?tab=referral redirects there whenever referralPartner exists
            (see the redirect logic above); activeTab can never equal
            "referral" by the time rendering reaches here. */}
    </BusinessAppShell>
  );
}

/** Shared "this tab needs Pro" lock state — still used by Performance and
 * Customer Inquiries, the two tabs that remain genuinely Pro-only after
 * the Free Tier Entitlement Reset V1 (Gallery/Products/Links & Contact
 * are unconditional now — see their own sections above, and the retired
 * LockedFindmiUrl counterpart this reset removed as dead code once the
 * Findmi URL card itself became unconditional).
 *
 * Business Manager Pro Invite / Promo Code Consistency pass — every one of
 * these locked tabs now also offers the exact same code redemption entry
 * point as Plan & Status (see that tab below), so a Free owner who already
 * has a Pro Invite/Promo code never has to go hunting in a different tab
 * to use it. Reuses ProInviteCodeEntry unmodified — no second redemption
 * system, same goToRedeemCode -> /redeem/[code] -> redeemProInvite() ->
 * redeem_pro_invite() RPC path as everywhere else it appears, with this
 * already-authorized businessId passed through as the same hint. `tabKey`
 * only affects returnTo (where a blank/no-op submission lands), never
 * which business the code applies to. */
function UpgradeLockedTab({
  businessId,
  tabKey,
  description,
  isAdminElevated,
}: {
  businessId: string;
  tabKey: string;
  description: string;
  isAdminElevated?: boolean;
}) {
  return (
    <div className={cardClass}>
      <p className="mt-1 text-body text-muted">{description}</p>
      <p className="mt-3 text-label font-semibold uppercase text-subtle">Available with Findmi Pro</p>
      {isAdminElevated ? (
        // Admin Manage-As V1 — starting a Stripe checkout or redeeming a
        // Pro Invite is identity-sensitive/financial (see Step 4 of this
        // pass), so these CTAs stay hidden in Admin Mode rather than
        // leading to a dead end — see AdminElevatedActionNotice below.
        <AdminElevatedActionNotice businessId={businessId} />
      ) : (
        <>
          <Link href={`/upgrade/pro?business=${businessId}`} className={`mt-3 ${primaryButtonClass}`}>
            Upgrade to Pro
          </Link>
          <div className="mt-3">
            <ProInviteCodeEntry
              returnTo={`/account/business/${businessId}?tab=${tabKey}`}
              businessId={businessId}
              heading="Have a Pro Invite or Promo Code?"
            />
          </div>
        </>
      )}
    </div>
  );
}

/** Admin Manage-As V1 — the shared "this is account-specific, not
 * entity management" notice for the handful of Business Manager CTAs
 * that intentionally stay real-owner-only (starting a Stripe checkout,
 * redeeming a Pro Invite — see this pass's Step 4). Shown instead of the
 * CTA itself, never as a dead link that would bounce an admin-only
 * session to /login. */
function AdminElevatedActionNotice({ businessId }: { businessId: string }) {
  return (
    <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-metadata font-semibold text-amber-800">Exit Admin Mode to perform this account-specific action.</p>
      <Link
        href={`/admin/businesses/${businessId}`}
        className="mt-1.5 inline-block text-metadata font-semibold text-amber-800 underline underline-offset-2 hover:text-amber-900"
      >
        Exit Admin Mode
      </Link>
    </div>
  );
}

/** Products V3 — presentation-only consolidation of the two genuinely
 * independent status axes (content moderation vs. marketplace
 * distribution — see OwnProduct above and ../actions.ts's own doc
 * comments) into the ONE truthful word a product row needs. Nothing
 * here reads or writes anything new: it's a pure function over the same
 * moderationStatus/hasPendingChanges/marketplaceStatus/is_active fields
 * already computed above. The underlying two-axis data model is
 * completely unchanged — full marketplaceStatus detail remains available
 * inside Edit (its own sentence + Submit/Cancel/Return actions); this
 * only decides
 * what ONE label the collapsed row shows, in the priority order an
 * owner would actually want to act on: inactive first (nothing else
 * matters if it's off), then anything content-moderation blocks public
 * visibility at all, then a standing content edit, then marketplace
 * distribution state, then the default healthy "Live". */
function productDisplayStatus(p: {
  is_active: boolean;
  moderationStatus: "pending_review" | "live" | "rejected";
  hasPendingChanges: boolean;
  marketplaceStatus: "catalog_only" | "submitted" | "approved" | "rejected" | "paused";
}): { label: string; tone: "quiet" | "positive" | "attention" | "negative" } {
  if (!p.is_active) return { label: "Inactive", tone: "quiet" };
  if (p.moderationStatus === "rejected") return { label: "Not approved", tone: "negative" };
  if (p.moderationStatus === "pending_review") return { label: "Pending review", tone: "attention" };
  if (p.hasPendingChanges) return { label: "Changes pending", tone: "attention" };
  if (p.marketplaceStatus === "submitted") return { label: "Marketplace pending", tone: "attention" };
  if (p.marketplaceStatus === "approved") return { label: "Marketplace approved", tone: "positive" };
  if (p.marketplaceStatus === "paused") return { label: "Marketplace paused", tone: "attention" };
  if (p.marketplaceStatus === "rejected") return { label: "Marketplace not approved", tone: "negative" };
  return { label: "Live", tone: "quiet" };
}

const PRODUCT_STATUS_TONE_CLASS: Record<ReturnType<typeof productDisplayStatus>["tone"], string> = {
  quiet: "text-muted",
  positive: "text-accent font-semibold",
  attention: "text-accent font-semibold",
  negative: "text-red-700/80 font-semibold",
};

/** Command Center V1 — one shared row for both the Today and Upcoming
 * sections, rendering a DashboardAppearance (lib/business-dashboard.ts)
 * without any standalone-vs-Event-linked branching of its own — that
 * distinction was already resolved into plain fields (eventName/eventHref/
 * geographyLabel/statusLabel) before this component ever sees it. */
function DashboardAppearanceRow({ appearance, showDate }: { appearance: DashboardAppearance; showDate: boolean }) {
  const locationLine = [appearance.venueName, [appearance.city, appearance.state].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="flex items-center gap-3 rounded-lg bg-findmi-50/60 px-3 py-2.5">
      {appearance.temporal.live ? (
        <span className="flex w-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg bg-findmi py-1.5 text-white">
          <LiveDotSmall />
          <span className="text-label font-bold uppercase">Now</span>
        </span>
      ) : (
        <ScheduleDateBadge iso={appearance.startAt} />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-semibold text-primary">{appearance.title}</p>
        <p className="mt-0.5 truncate text-metadata text-muted">
          {showDate ? `${formatDateShort(appearance.startAt)} · ` : ""}
          {formatTime(appearance.startAt)}–{formatTime(appearance.endAt)}
          {locationLine && ` · ${locationLine}`}
        </p>
        {appearance.eventName && (
          <p className="mt-0.5 truncate text-microcopy text-subtle">
            Part of{" "}
            {appearance.eventHref ? (
              <Link href={appearance.eventHref} className="underline underline-offset-2">
                {appearance.eventName}
              </Link>
            ) : (
              appearance.eventName
            )}
          </p>
        )}
      </div>
      <Link href={appearance.editHref} className="shrink-0 text-metadata font-semibold text-accent hover:underline">
        Manage
      </Link>
    </li>
  );
}

function LiveDotSmall() {
  return <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />;
}

/** Command Center V3.1 — the compact Coming Up row (live QA correction).
 * Same DashboardAppearance fields DashboardAppearanceRow uses (date, time,
 * location, geography, status, "Part of" event, Manage), condensed into
 * the flat divided-list grammar Appearance Analytics already proved
 * (PerformanceTab.tsx): a title line, one combined detail line, an
 * optional status/event line — no outer rounded/bordered card, no
 * separate temporal badge (these are never today's/live items — see
 * upcomingAppearances' own isToday filter — so the plain date already
 * shown in the detail line covers it without a second cue). Today keeps
 * DashboardAppearanceRow unchanged; this is Coming Up's own row, not a
 * shared component, since Today's visual treatment is explicitly accepted
 * and out of scope for this correction. */
function ComingUpRow({ appearance }: { appearance: DashboardAppearance }) {
  const venueLine = [appearance.venueName, [appearance.city, appearance.state].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join(", ");
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 first:pt-3 last:pb-3">
      <ScheduleDateBadge iso={appearance.startAt} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-semibold text-primary">{appearance.title}</p>
        <p className="mt-0.5 truncate text-metadata text-muted">
          {formatTime(appearance.startAt)}–{formatTime(appearance.endAt)}
          {venueLine && ` · ${venueLine}`}
        </p>
        {appearance.eventName && (
          <p className="mt-0.5 truncate text-microcopy text-subtle">
            Part of{" "}
            {appearance.eventHref ? (
              <Link href={appearance.eventHref} className="underline underline-offset-2">
                {appearance.eventName}
              </Link>
            ) : (
              appearance.eventName
            )}
          </p>
        )}
      </div>
      <Link href={appearance.editHref} className="shrink-0 text-metadata font-semibold text-accent hover:underline">
        Manage
      </Link>
    </li>
  );
}

/** Findmi Owner Product visual system — a compact month/day box, the
 * same "date column" scanning aid a real schedule-management surface
 * needs (the Loom references' own quality bar this pass targets), used
 * for both Where I'll Be's real Appearance rows and its event-only
 * participation rows so the two read as one consistent schedule list.
 *
 * Business Manager V4.1 — Where I'll Be prioritization. `live` switches
 * this to the exact same aqua "Now" tile DashboardAppearanceRow already
 * uses for Overview's own Today panel (same LiveDotSmall, same
 * treatment) — one consistent "happening now" visual language across the
 * whole workspace, not a second one invented for this tab. Callers derive
 * `live` from the same start_at/end_at every row already has via
 * getTemporalLabel (zero new data); a stop already in progress sorts
 * first in start_at-ascending order regardless, so this only needs to
 * badge it, never reorder the list. */
function ScheduleDateBadge({ iso, live }: { iso: string; live?: boolean }) {
  if (live) {
    return (
      <span className="flex w-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg bg-findmi py-1.5 text-white">
        <LiveDotSmall />
        <span className="text-label font-bold uppercase">Now</span>
      </span>
    );
  }
  const d = new Date(iso);
  return (
    <span className="flex w-11 shrink-0 flex-col items-center justify-center rounded-lg bg-black/[0.04] py-1.5">
      <span className="text-label font-bold uppercase text-subtle">
        {d.toLocaleDateString("en-US", { month: "short" })}
      </span>
      <span className="font-display text-body font-bold leading-none text-primary">{d.getDate()}</span>
    </span>
  );
}
