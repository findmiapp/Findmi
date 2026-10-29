import type { Metadata } from "next";
import { calendarDayOfMonth, calendarMonthAbbrev, compareChronological, formatCalendarDate, hasEnded, todayIn } from "@/lib/event-time";
import type { ReactNode } from "react";
import Link from "next/link";
import { eventHref } from "@/lib/event-links";
import { SCHEDULE_MAP_GAP_LABEL, scheduleMapGap } from "@/lib/schedule-map";
import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { errorRedirectUrl, isoToLocalDateTime } from "@/lib/admin/form-helpers";
import { isBusinessPro } from "@/lib/entitlements";
import { getManagerCore } from "../managerContext";
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
  buildHomeComingUp,
  countUpcomingDatesPerPreviewGroup,
  type DashboardAppearance,
  type DashboardAppearanceSource,
} from "@/lib/business-dashboard";
import ProInviteCodeEntry from "@/components/ProInviteCodeEntry";
import { Panel, Row, Stat, Chip, EmptyLine, SectionEyebrow } from "../../../owner-ui";
import BusinessHome from "../v2/BusinessHome";
import MoreMenu from "../v2/MoreMenu";
import ProfileSectionNav from "../v2/ProfileSectionNav";
import { LEGACY_TAB_REDIRECTS, VALID_BUSINESS_TAB_KEYS } from "../v2/business-nav";
import OpportunitiesView, { OPPORTUNITY_VIEWS, type OpportunityView } from "../v2/OpportunitiesView";
import { LocationsPresence, PastPresence, PlacesLens, PresenceHeader, parsePresenceView } from "../v2/PresenceViews";
import AddEventChooser from "../v2/AddEventChooser";
import GrowthFootprintBridge from "../v2/GrowthFootprintBridge";
import { ADD_EVENT_PARAM, eventImportHref, hostEventHref, parseComposeIntent } from "../v2/eventIntent";
import { getBusinessLocationEvidence, getLinkedLocationIds, getLocationsForBusiness, getManagedLocationsForUser, isManagingRole } from "@/lib/business-locations";
import { scopeLocationSuggestions } from "@/lib/location-matching";
import { getPendingInvitationsForBusiness, type OpportunityListItem } from "@/lib/opportunities";
import { getBusinessOpportunityItems, getExploreItems } from "@/lib/opportunity-listings";
import { getBrandAudit, getIdeasForBusiness } from "@/lib/brand-audit";
import { getBusinessMoments, isMomentFilter } from "@/lib/business-moments";
import { GrowthGoalsView, GrowthIdeasView, GrowthTargetsHeader, growthBadges, growthSummaryFor } from "../v2/GrowthView";
import GrowthNav from "../v2/GrowthNav";
import MomentsView from "../v2/MomentsView";
import AvailableAtView from "../v2/AvailableAtView";
import { FindUsViewSwitch } from "../v2/MarketFootprintView";
import { getOwnerAvailabilityPage } from "@/lib/business-availability-owner";
import { parseAvailabilityFilter } from "@/lib/business-availability-bulk-domain";
import { canEditTargets, parseTargetFilter } from "@/lib/business-targets-domain";
import { adminGetTargetInternalNotes, getBusinessTarget, getBusinessTargetsPage, getFollowUpTargets, getTargetActivityPage, getTargetPursuit } from "@/lib/business-targets";
import { followUpToday, getGeographyDetail, getGeographyOverview, getGrowingIn, getRelationshipWorkspace } from "@/lib/business-relationships";
import { buildFollowUps } from "@/lib/business-follow-ups";
import { buildBusinessRequests } from "@/lib/business-requests";
import { cleanSlug, resolveGeographyScope } from "@/lib/geography-scope";
import RelationshipWorkspace from "../v2/RelationshipWorkspace";
import TargetWorkspace from "../v2/TargetWorkspace";
import { GeographyDetailView, GeographyOverviewView } from "../v2/GeographyViews";
import { isAdminSession } from "@/lib/admin/auth";
import TargetsView from "../v2/TargetsView";
import DiscoverView from "../v2/DiscoverView";
import { parseCommercialQuery } from "@/lib/discovery/commercial";
import { getCommercialDiscovery } from "@/lib/discovery/commercial-server";
import { getInboundInquiryRequests, getTargetInquiries } from "@/lib/commercial-inquiries";
import { contextualOpportunities } from "@/lib/relationship-context";
import { isCommercialIntent } from "@/lib/commercial-intents";
import { managerHref, originBack } from "@/lib/manager-links";
import PublicActionsEditor from "@/components/public-actions/PublicActionsEditor";
import { getPublicActionsEditorData } from "@/lib/public-actions";
import VisibilityChip from "@/components/profile/VisibilityChip";
import { bulletinFingerprint, fieldVisibility } from "@/lib/profile-visibility";
import { readBusinessFieldStatus } from "@/lib/profile-visibility-server";
import { getProductSets } from "@/lib/business-product-sets";
import { PerformanceViewTabs, QrCodesView, QrSnapshot } from "../v2/PerformanceViews";
import { respondToIdeaAction } from "../brand-audit/actions";
import { getBusinessGoals } from "@/lib/opportunity-goals";
import { canManageGoals, type GoalRole } from "@/lib/opportunity-goals-domain";
import { isExploreTiming, isOpportunityType, type ExploreFilters } from "@/lib/opportunity-listings-domain";
import { isParticipationCostFilter } from "@/lib/opportunity-participation-cost";
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
  updateMemberProductCommerce,
  updateBusinessGallery,
  updateBusinessBrandImages,
  updateBusinessLinks,
  updateBusinessProfile,
  updateMemberProduct,
  updateBusinessHandle,
  updateOwnerAppearance,
} from "../../actions";
import { getEntityHandle } from "@/lib/handles";
import OwnerMarketplacePanel from "@/components/OwnerMarketplacePanel";
import { ownerMarketplaceState } from "@/lib/commerce/marketplace-presentation";
import { loadMarketplaceReadiness } from "@/lib/commerce/marketplace-readiness-server";
import type { MarketplaceReadiness } from "@/lib/commerce/marketplace-eligibility";
import { getProductWantCounts, type ProductDemand } from "@/lib/product-wants";
import { getUpcomingAppearanceOptionsForBusiness, type SelectOption } from "@/lib/admin/queries";
import MemberImageField from "../MemberImageField";
import MemberGalleryField from "../MemberGalleryField";
import MemberProductActiveButton from "../MemberProductActiveButton";
import AppearanceFieldsForm, { type AppearanceFieldValues } from "../AppearanceFieldsForm";
import type { AccountSearchResult } from "@/components/account/AccountRelationPicker";
import AppearanceEditorDetails from "../AppearanceEditorDetails";
import EventSearchPicker from "../EventSearchPicker";
import RemoveAppearanceButton from "../RemoveAppearanceButton";
import ProductFieldsForm, { type ProductFieldValues } from "../ProductFieldsForm";
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
import CustomerInquiriesForm from "../CustomerInquiriesForm";
import {
  getBusinessOrderDetail,
  getBusinessOrderList,
  getBusinessOrderSummary,
  type BusinessOrderStatusFilter,
} from "@/lib/business-orders";
import { updateOrderItemFulfillment } from "../../orders-actions";
import { FULFILLMENT_LABELS } from "@/lib/commerce/quote";
import { getBusinessMarketAssignments } from "@/lib/admin/business-markets";
import {
  DEFAULT_OWNER_PERFORMANCE_RANGE,
  getOwnerBusinessPerformance,
  isOwnerPerformanceRange,
} from "@/lib/analytics/ownerPerformance";
import PerformanceTab from "../PerformanceTab";
import { QrCampaignContextualPanel } from "../QrCampaignCreator";
import QrCampaignGroups from "../QrCampaignGroups";
import { getBusinessQrCampaigns } from "@/lib/qr-manager";
import { getBusinessMarketLimit } from "@/lib/entitlements";
import { getPendingMarketRequestForBusiness } from "@/lib/market-requests";
import SupabaseImage from "@/components/SupabaseImage";
import ChevronIcon from "@/components/ChevronIcon";
import type { EventParticipationStatus } from "@/lib/types";
import { imageVariantUrl } from "@/lib/image-variants";
import UnsavedChangesGuard from "@/components/UnsavedChangesGuard";

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

/** Starts a read right now and marks its rejection as handled, so several
 * independent reads can be started together and awaited later without an
 * unhandled-rejection warning if an earlier await throws first. Awaiting the
 * returned promise still throws as usual. */
function started<T>(p: Promise<T>): Promise<T> {
  p.catch(() => {});
  return p;
}
/** `make()` runs only when this destination renders what it feeds; otherwise
 * the fallback stands in and nothing is read. */
function whenP<T>(needed: boolean, make: () => Promise<T>, fallback: T): Promise<T> {
  return needed ? started(make()) : Promise.resolve(fallback);
}
/** Same, for a Supabase list query: resolves to its rows ([] when skipped). */
function rowsWhen<T>(needed: boolean, make: () => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  return whenP(needed, async () => (await make()).data ?? [], [] as T[]);
}

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
// Tab keys, nav labels and legacy redirects live in ./v2/business-nav.ts
// (shared with the shell and the More menu).
const VALID_TAB_KEYS = VALID_BUSINESS_TAB_KEYS;

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
type ManagerSearchParams = {
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
    participationCost?: string;
    goal?: string;
    show?: string;
    /** Find Us Here list: search, status, relationship, imported, page. */
    fq?: string;
    fs?: string;
    fr?: string;
    fi?: string;
    fp?: string;
    /** Find Us Here → By Market: view switch and the selected Market's slug. */
    fv?: string;
    fm?: string;
    /** Targets: search, status, kind (Growth only), page, the open Business /
     * Event Target (tgt), and the legacy open Target id (pt). */
    tq?: string;
    ts?: string;
    tk?: string;
    tp?: string;
    tgt?: string;
    /** Arriving from a public action: open the Inquiry composer on this intent. */
    inquire?: string;
    // Where a deep screen was opened from (lib/manager-links MANAGER_ORIGINS).
    from?: string;
    pt?: string;
    /** By Market: an Area inside the Market (fa), and the relationship workspace's place (loc). */
    fa?: string;
    loc?: string;
    /** Growth → Targets → Discover: Market, Area, entity, Category, search, page. */
    dm?: string;
    da?: string;
    de?: string;
    dc?: string;
    dq?: string;
    dp?: string;
    /** Home: "all" shows every Inbox / Follow-Ups row instead of the first few
     * (`followups` / `requests` are the older links to the same expansion). */
    inbox?: string;
    followups?: string;
    requests?: string;
};

export default async function ManageBusinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ManagerSearchParams>;
}) {
  const { id } = await params;
  const rawSearchParams = await searchParams;
  const tab = rawSearchParams.tab && VALID_TAB_KEYS.has(rawSearchParams.tab) ? rawSearchParams.tab : "overview";

  // Redirect-only tab keys depend on the URL alone, so they bounce here,
  // before anything is rendered or read (a legacy key never renders a second
  // copy of content that moved).
  if (LEGACY_TAB_REDIRECTS[tab]) {
    redirect(`/account/business/${id}?tab=${LEGACY_TAB_REDIRECTS[tab]}`);
  }
  // The Opportunity goals list moved to Growth → Goals; the old
  // ?tab=opportunities&view=goals link (and the goal wizard's old return
  // target) still lands there, with its saved/paused notice intact.
  if (tab === "opportunities" && rawSearchParams.view === "goals") {
    redirect(`/account/business/${id}?tab=growth${rawSearchParams.goal ? `&goal=${encodeURIComponent(rawSearchParams.goal)}` : ""}`);
  }
  // A Target is private commercial INTENT, owned by Growth — never current
  // Find Us Here inventory. The retired Find Us Here → Targets sub-view
  // (…&view=find-us&fv=targets) lands on Growth → Targets, the same
  // records and actions; a relationship workspace opened from it still
  // opens in place.
  if (tab === "findmi-here" && rawSearchParams.view === "find-us" && rawSearchParams.fv === "targets" && !rawSearchParams.loc && !rawSearchParams.tgt && !rawSearchParams.pt) {
    redirect(managerHref(id, "targets"));
  }

  // No server-side Suspense on purpose. Entering a destination already paints
  // its skeleton on the tap itself (v2/ManagerNav → ManagerContentFrame), and
  // moving within one keeps the current view with its tab highlight already
  // moved (v2/OptimisticTabs), so the user never waits on a blank or stale
  // screen. A Suspense fallback here would only add to that: React holds back
  // the reveal of resolved content for ~300ms after a fallback is committed,
  // which made fast responses slower, not faster.
  return <ManagerContent id={id} rawSearchParams={rawSearchParams} />;
}

/** The content view of one Business Manager destination (everything inside
 * the persistent shell). Authorizes for itself — a layout is not re-run on a
 * `?tab=` switch. */
async function ManagerContent({ id, rawSearchParams }: { id: string; rawSearchParams: ManagerSearchParams }) {
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

  // Shared manager context — login bounce, requireBusinessMember (the real
  // session-scoped authorization; never trusts anything from the URL beyond
  // the id) and the Business row, resolved once per request. The persistent
  // shell (the layout above this page) reads the same cached values, but a
  // layout is not re-run when only `?tab=` changes, so this page authorizes
  // for itself on every navigation. plan_tier isn't in the public column
  // grant, hence the service-role read inside, after authorization.
  const { user, admin, membershipRole, isAdminElevated, business } = await getManagerCore(id);

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
  const profileAction = updateBusinessProfile.bind(null, id);
  const linksAction = updateBusinessLinks.bind(null, id);
  const galleryAction = updateBusinessGallery.bind(null, id);
  const brandImagesAction = updateBusinessBrandImages.bind(null, id);

  // ── What this request actually needs ───────────────────────────────────
  // The manager is one page with a `?tab=` per destination, and every
  // destination used to pay for every other destination's data (a visit to
  // the static More menu ran ~30 queries: orders, markets, QR scans, events,
  // products…). Each read below now runs only for the destination that
  // renders it, and everything a destination does need starts together, so
  // the request waits for the slowest read rather than the sum of them.
  // (The persistent shell's own data is not here at all — see ./layout.tsx.)
  const presenceView = parsePresenceView(viewParam);
  // Findmi Here → Events: which intent panel is open (Hosting An Event /
  // Appearing At An Event). compose=1 stays the Appearing composer, so every
  // existing "Where I'll Be" link still lands on it.
  const composeIntent = parseComposeIntent(composeParam);
  const composeOpen = composeIntent === "appearing";
  // Hosting has ONE place: the canonical Host an Event page (it offers
  // Import Event or Create Manually). An older ?compose=hosting link lands
  // there directly — no second Import / Create Manually chooser here.
  if (composeIntent === "hosting") redirect(hostEventHref(id));

  // ?tab=referral only ever existed for a referral partner: a partner lands
  // in Settings, anyone else falls back to Overview (see below).
  const referralPromise = started(
    tab === "referral" || tab === "settings" ? getReferralPartnerByBusinessId(id) : Promise.resolve(null)
  );
  if (tab === "referral" && (await referralPromise)) {
    redirect(`/account/business/${id}?tab=settings`);
  }
  const activeTab = tab === "referral" ? "overview" : tab;

  const onHome = activeTab === "overview";
  const onFindmiHere = activeTab === "findmi-here";
  const onUpcoming = onFindmiHere && presenceView === "upcoming";
  const onPast = onFindmiHere && presenceView === "past";
  const onFindUs = onFindmiHere && presenceView === "find-us";
  const onFindUsMarkets = onFindUs && rawSearchParams.fv === "markets";
  const onFindUsTargets = onFindUs && rawSearchParams.fv === "targets";
  const onFindUsPlaces = onFindUs && !onFindUsMarkets && !onFindUsTargets;
  // Targets have two doors onto ONE set of business_targets records, one view and
  // one set of actions: Growth → Targets (every kind) and Findmi Here → Find Us
  // Here → Targets (the Places-only lens).
  const onGrowthTargets = activeTab === "growth" && viewParam === "targets";
  // Growth → Targets → Discover (Commercial Discovery): finds who or what to target.
  const onDiscover = activeTab === "growth" && viewParam === "discover";
  const onTargets = onFindUsTargets || onGrowthTargets;
  const targetsFilter = parseTargetFilter({ q: rawSearchParams.tq, status: rawSearchParams.ts, kind: onGrowthTargets ? rawSearchParams.tk : undefined });
  const marketKey = onFindUsMarkets && typeof rawSearchParams.fm === "string" ? rawSearchParams.fm.replace(/[^a-z0-9-]/gi, "").slice(0, 60) : "";
  const areaKey = onFindUsMarkets && marketKey && marketKey !== "none" ? cleanSlug(rawSearchParams.fa) : "";
  // The Business ↔ Location relationship workspace — ONE page per place, opened
  // from any lens (Places, By Market, Targets, Growth → Targets) with `loc`.
  // A Business or Event Target opens its own Target workspace with `tgt`;
  // legacy `pt` (a Placement id — kept as the migrated Target's id) resolves to
  // whichever of the two it is.
  const workspaceDoor = onFindUs || onGrowthTargets;
  const requestedLoc = workspaceDoor && typeof rawSearchParams.loc === "string" ? rawSearchParams.loc : "";
  const legacyPt = workspaceDoor && !requestedLoc && typeof rawSearchParams.pt === "string" ? rawSearchParams.pt : "";
  const requestedTgt = workspaceDoor && !requestedLoc && typeof rawSearchParams.tgt === "string" ? rawSearchParams.tgt : "";
  const wantsWorkspace = Boolean(requestedLoc || legacyPt || requestedTgt);
  const findUsFilter = parseAvailabilityFilter({ q: rawSearchParams.fq, status: rawSearchParams.fs, relationship: rawSearchParams.fr, imported: rawSearchParams.fi });
  const onLocations = onFindmiHere && presenceView === "locations";
  const onProfile = activeTab === "profile";
  const onGallery = activeTab === "gallery";
  const onProducts = activeTab === "products";
  const onSettings = activeTab === "settings";
  const onPerformance = activeTab === "performance";
  const onOrders = activeTab === "orders";
  const onMore = activeTab === "more";
  const needsGrowth = onHome || activeTab === "growth" || activeTab === "opportunities";
  /** Home and Findmi Here → Upcoming render the Business's own schedule; Home,
   * Upcoming and Past also render the Events it hosts. */
  const needsSchedule = onHome || onUpcoming;
  const needsHosted = onHome || onUpcoming || onPast;

  // QR Campaigns V1 — this Business's own QR campaigns, so every contextual
  // "Create QR Code"/"View QR Code" affordance on a Product row or an
  // Appearance row can show whether a campaign already exists without a new
  // query per row. Only the two views with such rows need it (Findmi Here →
  // Upcoming, Products). Free-tier reachable: never plan-gated (see
  // qr-actions.ts). Multiple campaigns per entity are the intended model
  // ("Table Sign" and "Store Window" on the same Product), so these are lists.
  const loadQrByEntity = async () => {
    const qrCampaignsByAppearanceId = new Map<string, { id: string; name: string; scans: number }[]>();
    const qrCampaignsByProductId = new Map<string, { id: string; name: string; scans: number }[]>();
    const { data: qrCampaignRows } = await admin
      .from("qr_campaigns")
      .select("id, name, appearance_id, product_id, is_active")
      .eq("business_id", id)
      .order("created_at", { ascending: false });
    // Scan counts reuse the exact same qr_scan/qr_campaign_id shape
    // ownerPerformance.ts/qrCampaignDetail.ts already query.
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
    return { qrCampaignsByAppearanceId, qrCampaignsByProductId };
  };

  // Owner-Facing Market Display V1 — read-only for owners: the admin-only
  // read helper the Admin → Business → Markets tab already uses, scoped to
  // THIS business by its own `.eq("business_id", id)`. Needed by Settings and
  // by Home's Needs Attention.
  const loadMarkets = async () => {
    const [marketAssignments, marketLimit] = await Promise.all([getBusinessMarketAssignments(admin, id), getBusinessMarketLimit(business)]);
    const primaryMarket = marketAssignments.find((m) => m.relationship === "primary" && m.active) ?? null;
    const additionalMarkets = marketAssignments.filter((m) => m.relationship === "additional" && m.active);
    const activeMarketCount = (primaryMarket ? 1 : 0) + additionalMarkets.length;
    // Consumer Area Picker + Market Requests V1 — a business created via the
    // "request a missing Market" path has no active Primary Market yet; show
    // what was actually requested instead of a bare "Not assigned yet".
    const pendingMarketRequest = primaryMarket ? null : await getPendingMarketRequestForBusiness(admin, id);
    return {
      primaryMarket,
      additionalMarkets,
      marketLimit,
      activeMarketCount,
      overMarketAllowance: marketLimit !== null && activeMarketCount > marketLimit,
      pendingMarketRequest,
    };
  };
  const noMarkets: Awaited<ReturnType<typeof loadMarkets>> = {
    primaryMarket: null,
    additionalMarkets: [],
    marketLimit: null,
    activeMarketCount: 0,
    overMarketAllowance: false,
    pendingMarketRequest: null,
  };

  // Business Order Management Overhaul V1 — every query inside these helpers
  // is itself filtered by business_id, so this business can never see another
  // business's order items even within the same multi-vendor order (see
  // lib/business-orders.ts). The summary feeds Home's Needs Attention, the
  // Orders tab and (Pro only) More's Orders link; the list and the open order
  // are the Orders tab alone.
  const validOrderFilters = new Set<BusinessOrderStatusFilter>(["new", "open", "ready", "fulfilled", "cancelled"]);
  const orderStatus = orderStatusFilter && validOrderFilters.has(orderStatusFilter as BusinessOrderStatusFilter)
    ? (orderStatusFilter as BusinessOrderStatusFilter)
    : undefined;
  const noOrderSummary = { newCount: 0, openCount: 0, readyCount: 0, fulfilledCount: 0, cancelledCount: 0 };

  // /account V2 Pass 2 — Business Locations, fetched only for that view.
  // Read via the service-role client (already authorized above) so the
  // owner also sees their own pending/archived connected Locations.
  const loadBusinessLocationsView = async () => {
    const [page, managed, evidence] = await Promise.all([
      getLocationsForBusiness(admin, id),
      user ? getManagedLocationsForUser(admin, user.id) : Promise.resolve([]),
      getBusinessLocationEvidence(admin, id),
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
      // Scoped to THIS Business (lib/location-matching.ts): a Location the
      // person manages for an unrelated Business is never suggested here.
      connectable: scopeLocationSuggestions({
        businessName: business.name,
        managed,
        evidenceLocationIds: evidence,
        linkedIds: new Set([...linkedIds, ...alsoLinked]),
      }),
      // Admin Manage-As can manage every Location (lib/permissions.ts).
      manageableIds: isAdminElevated ? page.items.map((l) => l.locationId) : page.items.map((l) => l.locationId).filter((lid) => managedIds.has(lid)),
    };
  };

  // Moments posted as this Business: all of them for the Moments view, the
  // latest few for Home's strip.
  const momentFilter = isMomentFilter(rawSearchParams.show) ? rawSearchParams.show : "all";
  const emptyMoments = { moments: [], counts: { all: 0, us: 0, connected: 0, events: 0, locations: 0 } };
  // Opportunities V2 — the page's views. Explore data is only read when that
  // view is open; both tolerate the V2 migration not being applied yet
  // (available: false).
  const opportunityView: OpportunityView =
    activeTab === "opportunities" && OPPORTUNITY_VIEWS.includes(viewParam as OpportunityView) ? (viewParam as OpportunityView) : "for-you";
  const exploreFilters: ExploreFilters = {
    q: rawSearchParams.q?.slice(0, 100) ?? null,
    type: isOpportunityType(rawSearchParams.type) ? rawSearchParams.type : null,
    where: rawSearchParams.where?.slice(0, 100) ?? null,
    timing: isExploreTiming(rawSearchParams.timing) ? rawSearchParams.timing : null,
    participationCost: isParticipationCostFilter(rawSearchParams.participationCost) ? rawSearchParams.participationCost : null,
  };
  const growthView = activeTab === "growth" && viewParam === "ideas" ? "ideas" : onGrowthTargets ? "targets" : onDiscover ? "discover" : "goals";
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

  // Owner Performance V1 — only queried when this tab is actually open
  // (analytics aggregation is heavier than this page's other summary
  // reads). Free/Pro Entitlement Realignment pass — Analytics is Pro-only
  // again: gated here too, not just at render, so a Free owner on the deep
  // Performance TAB never triggers the query at all. Business Overview V2 —
  // Home's Performance Pulse needs the SAME numbers for BOTH Free and Pro
  // (Free sees raw values only), so it reuses this one locked function rather
  // than a second "basic" query, which guarantees Overview's numbers can
  // never drift from the Performance tab's own definition. Free vs Pro is
  // never a reporting-PERIOD distinction: both tiers get the resolved
  // perfRange (30 days by default, ?range= if present).
  const perfRange = isOwnerPerformanceRange(rangeParam) ? rangeParam : DEFAULT_OWNER_PERFORMANCE_RANGE;

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
    location: { id: string; name: string; city: string | null; state: string | null; latitude?: number | null; longitude?: number | null } | null;
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
  // Account Home — every non-canceled row's identity + dates (unpaged), so
  // Coming Up's "N more dates" never depends on the schedule page size.
  let allScheduleRows: {
    id: string;
    event_id: string | null;
    event_occurrence_id: string | null;
    source: string | null;
    start_at: string;
    end_at: string | null;
    created_at: string;
  }[] = [];
  // Business-Hosted Events V1 — Events this Business HOSTS, sourced ONLY
  // from events.host_business_id (never participation, appearances, a
  // featured flag or organizer_name). Split by the same "has an upcoming
  // (non-cancelled) date" rule the rest of Findmi Here uses; an Event whose
  // dates are all past joins the existing Past list.
  type HostedEventRow = {
    id: string;
    name: string;
    slug: string;
    /** Null when the date has no published time (Event date/time precision). */
    startAt: string | null;
    endAt: string | null;
    /** The real calendar date (YYYY-MM-DD). */
    date: string;
    where: string | null;
    venueName: string | null;
    city: string | null;
    state: string | null;
    upcomingCount: number;
    statusLabel: string | null;
    coverImageUrl: string | null;
    /** B2 — every not-yet-ended date, soonest first (Home's Coming Up). */
    upcomingDates: { startAt: string | null; endAt: string | null; date: string }[];
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
    /** Null for an Event date with no published time (Event date/time precision). */
    startAt: string | null;
    endAt: string | null;
    /** The real calendar date (YYYY-MM-DD). */
    date: string;
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

  const loadSchedule = async () => {
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

    const skipped = Promise.resolve({ data: null });
    const [{ data: appearanceRows }, { data: linkedIdRows }, { data: ebStatusRows }, { data: eobStatusRows }, { data: hostedEvents }] = await Promise.all([
      !needsSchedule ? skipped : admin
        .from("appearances")
        .select(
          "id, title, start_at, end_at, venue_name, address, city, state, external_url, flyer_image_url, event_id, event_occurrence_id, source, created_at, location:locations(id, name, city, state, latitude, longitude)"
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
      !needsSchedule ? skipped : admin
        .from("appearances")
        .select("id, event_id, event_occurrence_id, source, start_at, end_at, created_at")
        .eq("business_id", id)
        .neq("status", "canceled"),
      !needsSchedule ? skipped : admin.from("event_businesses").select("event_id, status").eq("business_id", id),
      !needsSchedule ? skipped : admin.from("event_occurrence_businesses").select("occurrence_id, status").eq("business_id", id),
      // Business-Hosted Events V1 — Events this Business HOSTS, sourced ONLY
      // from events.host_business_id (never participation, appearances, a
      // featured flag or organizer_name). Independent of the reads above, so
      // it shares their round trip.
      !needsHosted
        ? skipped
        : admin
            .from("events")
            .select("id, name, slug, start_at, end_at, start_date, end_date, venue_name, city, state, is_demo, publication_status, cover_image_url")
            .eq("host_business_id", id)
            .is("trashed_at", null),
    ]);
    // …and its dates, which need the hosted ids, start now and are awaited
    // where the hosted rows are built (alongside the Add picker's own reads).
    const hostedIds = (hostedEvents ?? []).map((ev) => ev.id as string);
    const hostedOccurrencesPromise = hostedIds.length
      ? started(
          Promise.resolve(
            admin
              .from("event_occurrences")
              .select("event_id, occurrence_date, timezone, start_at, end_at, status, venue_name, city, state, location:locations(name, city, state)")
              .in("event_id", hostedIds)
              .neq("status", "cancelled")
              .order("occurrence_date", { ascending: true })
              .order("start_at", { ascending: true, nullsFirst: false })
          )
        )
      : null;

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
    allScheduleRows = linkedIdRows ?? [];
    const linkedEventIds = new Set((linkedIdRows ?? []).filter((r) => !r.event_occurrence_id).map((r) => r.event_id));
    const linkedOccurrenceIds = new Set((linkedIdRows ?? []).map((r) => r.event_occurrence_id).filter((x): x is string => Boolean(x)));

    // Findmi Here → Upcoming only: the Add picker's options and the
    // approved/pending Event participations that have no `appearances` row.
    // These read every upcoming platform Event and date, so no other
    // destination pays for them.
    if (onUpcoming) {
    // Picker: upcoming, non-demo events not already on this business's
    // own appearance calendar. An event with occurrences is only ever
    // offered per-date (never as a bare event-level option) — a
    // recurring event is always added at the occurrence level.
    const [{ data: events }, { data: occurrences }] = await Promise.all([
      admin.from("events").select("id, name, slug, is_demo, start_at, end_at, start_date, end_date, venue_name, city, state").eq("is_demo", false),
      // Upcoming dates: a known start still ahead, or (no published time)
      // a calendar date today or later — never dropped for a missing time.
      admin
        .from("event_occurrences")
        .select("id, event_id, occurrence_date, start_at, timezone")
        .or(`start_at.gt.${nowIso},and(start_at.is.null,occurrence_date.gte.${todayIn()})`)
        .order("occurrence_date")
        .order("start_at", { nullsFirst: false }),
    ]);

    const occurrencesByEvent = new Map<string, { id: string; occurrence_date: string; start_at: string | null; timezone: string }[]>();
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
            dateLabel: occ.start_at ? `${formatDateShortInZone(occ.start_at, occ.timezone)} · ${formatTimeInZone(occ.start_at, occ.timezone)}` : `${formatCalendarDate(occ.occurrence_date, "short")} · Time Not Listed`,
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
        const upcoming = ev.end_at ? new Date(ev.end_at) > new Date() : ev.start_at ? new Date(ev.start_at) > new Date() : !hasEnded(ev);
        if (!upcoming || linkedEventIds.has(ev.id)) continue;
        requestOptions.push({
          value: `event:${ev.id}`,
          name: ev.name,
          dateLabel: ev.start_at ? `${formatDateShort(ev.start_at)} · ${formatTime(ev.start_at)}` : `${formatCalendarDate(ev.start_date, "short")} · Time Not Listed`,
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
      // Not over (a timed end still ahead, or no published end and its
      // calendar end date not yet passed).
      if (!ev || hasEnded(ev)) continue;
      eventOnlySchedule.push({
        key: `event:${ev.id}`,
        title: ev.name,
        startAt: ev.start_at,
        endAt: ev.end_at,
        date: ev.start_date,
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
        date: occ.occurrence_date,
        where: [ev.venue_name, [ev.city, ev.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || null,
        href: `/event/${ev.slug}`,
      });
    }
    eventOnlySchedule.sort(compareScheduleRows);

    const isAwaitingDecision = (status: string) => status === "applied" || status === "pending";
    const venueFor = (ev: { venue_name: string | null; city: string | null; state: string | null }) =>
      [ev.venue_name, [ev.city, ev.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || null;
    for (const r of ebStatusRows ?? []) {
      if (!isAwaitingDecision(r.status)) continue;
      const ev = eventById.get(r.event_id);
      if (!ev || hasEnded(ev)) continue;
      pendingSchedule.push({ key: `pending-event:${ev.id}`, title: ev.name, startAt: ev.start_at, endAt: ev.end_at, date: ev.start_date, where: venueFor(ev), href: `/event/${ev.slug}` });
    }
    for (const r of eobStatusRows ?? []) {
      if (!isAwaitingDecision(r.status)) continue;
      // occurrenceById holds upcoming dates only, so past requests drop out.
      const occ = occurrenceById.get(r.occurrence_id);
      const ev = occ ? eventById.get(occ.event_id) : undefined;
      if (!occ || !ev) continue;
      pendingSchedule.push({ key: `pending-occurrence:${occ.id}`, title: ev.name, startAt: occ.start_at, endAt: null, date: occ.occurrence_date, where: venueFor(ev), href: `/event/${ev.slug}` });
    }
    pendingSchedule.sort(compareScheduleRows);
    }

    const { data: hostedOccurrences } = hostedOccurrencesPromise ? await hostedOccurrencesPromise : { data: [] };
    type HostedOccurrence = {
      event_id: string;
      occurrence_date: string;
      timezone: string;
      start_at: string | null;
      end_at: string | null;
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
    for (const ev of hostedEvents ?? []) {
      hostedEventIds.add(ev.id);
      const occs = hostedOccByEvent.get(ev.id) ?? [];
      const statusLabel = !ev.is_demo ? null : ev.publication_status === "rejected" ? "Needs Changes" : "In Review";
      const place = (p: { venue_name: string | null; city: string | null; state: string | null }) =>
        [p.venue_name, [p.city, p.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || null;
      if (occs.length > 0) {
        // Not over: a timed date until its end; otherwise through its day.
        const upcoming = occs.filter((o) => !hasEnded(o));
        const pick = upcoming[0] ?? occs[occs.length - 1];
        const loc = Array.isArray(pick.location) ? (pick.location[0] ?? null) : pick.location;
        const row: HostedEventRow = {
          id: ev.id,
          name: ev.name,
          slug: ev.slug,
          startAt: pick.start_at,
          endAt: pick.end_at,
          date: pick.occurrence_date,
          where: loc ? place({ venue_name: loc.name, city: loc.city, state: loc.state }) : place(pick),
          venueName: loc?.name ?? pick.venue_name,
          city: loc?.city ?? pick.city,
          state: loc?.state ?? pick.state,
          upcomingCount: upcoming.length,
          statusLabel,
          coverImageUrl: ev.cover_image_url ?? null,
          upcomingDates: upcoming.map((o) => ({ startAt: o.start_at, endAt: o.end_at, date: o.occurrence_date })),
        };
        (upcoming.length > 0 ? hostedUpcoming : hostedPast).push(row);
      } else {
        const stillOn = !hasEnded(ev);
        const row: HostedEventRow = {
          id: ev.id,
          name: ev.name,
          slug: ev.slug,
          startAt: ev.start_at,
          endAt: ev.end_at,
          date: ev.start_date,
          where: place(ev),
          venueName: ev.venue_name,
          city: ev.city,
          state: ev.state,
          upcomingCount: stillOn ? 1 : 0,
          statusLabel,
          coverImageUrl: ev.cover_image_url ?? null,
          upcomingDates: stillOn ? [{ startAt: ev.start_at, endAt: ev.end_at, date: ev.start_date }] : [],
        };
        (row.upcomingCount > 0 ? hostedUpcoming : hostedPast).push(row);
      }
    }
    hostedUpcoming.sort((a, b) => compareScheduleRows({ key: a.id, startAt: a.startAt, date: a.date }, { key: b.id, startAt: b.startAt, date: b.date }));

    // Read-side dedupe only (no data changes): an Event this Business hosts
    // is represented once, by its Hosting row — its Event-level
    // participation placeholders don't repeat it. Date-level rows stay.
    eventOnlySchedule = eventOnlySchedule.filter((e) => !(e.key.startsWith("event:") && hostedEventIds.has(e.key.slice("event:".length))));
    pendingSchedule = pendingSchedule.filter(
      (e) => !(e.key.startsWith("pending-event:") && hostedEventIds.has(e.key.slice("pending-event:".length)))
    );
  };

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
    /** The ONE Marketplace rule's answer (both gates + exact blockers). */
    readiness: MarketplaceReadiness;
    /** Aggregate demand only — never who. */
    demand: ProductDemand;
    /** Checkout setup form defaults (owner-managed commerce fields). */
    commerce: { purchasable: boolean; soldOut: boolean; pickupEnabled: boolean; pickupPrice: string; eventPickupIds: string[] };
  };
  let productPickupAppearances: SelectOption[] = [];
  let products: OwnProduct[] = [];
  let productCategories: Awaited<ReturnType<typeof getProductCategories>> = [];
  // Free Tier Entitlement Reset V1 — fetched for every business now. The
  // Products tab UI itself was already unlocked for Free (see its own
  // section below); this data fetch had fallen out of sync with that —
  // without it, a Free owner's own newly-created products would never
  // appear in their own management view even though creation itself
  // (createMemberProduct, ../actions.ts) already worked.
  const loadProducts = async () => {
    const [{ data: productRows }, fetchedProductCategories, { data: commerceRow }] = await Promise.all([
      admin
        .from("products")
        .select(
          "id, name, slug, description, image_url, price, price_label, product_type, external_purchase_url, is_active, moderation_status, pending_changes, marketplace_status, purchasable, inventory_status, archived_at, trashed_at"
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
      // Marketplace needs real Findmi checkout (lib/commerce/marketplace-eligibility.ts).
      admin.from("businesses").select("commerce_enabled, is_demo, publication_status").eq("id", id).maybeSingle(),
    ]);
    productCategories = fetchedProductCategories;
    const businessCommerce = (commerceRow ?? null) as { commerce_enabled?: boolean; is_demo?: boolean; publication_status?: string } | null;

    const productIds = (productRows ?? []).map((p) => p.id);
    // Canonical readiness, aggregate demand (counts only — this is normal
    // Business Manager access; identities never leave the server), and the
    // owner-managed checkout setup, all in one parallel batch.
    const [{ data: categoryLinks }, readinessById, demandById, { data: fulfillmentRows }, pickupAppearances] = await Promise.all([
      productIds.length > 0
        ? admin.from("product_categories").select("product_id, category_id").in("product_id", productIds)
        : Promise.resolve({ data: [] as { product_id: string; category_id: string }[] }),
      loadMarketplaceReadiness(admin, productRows ?? [], () => businessCommerce),
      getProductWantCounts(admin, productIds),
      productIds.length > 0
        ? admin.from("product_fulfillment_options").select("product_id, method, price, appearance_id").in("product_id", productIds).eq("enabled", true)
        : Promise.resolve({ data: [] as { product_id: string; method: string; price: number; appearance_id: string | null }[] }),
      getUpcomingAppearanceOptionsForBusiness(id),
    ]);
    productPickupAppearances = pickupAppearances;
    const fulfillment = (fulfillmentRows ?? []) as { product_id: string; method: string; price: number; appearance_id: string | null }[];
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
        readiness: readinessById.get(p.id)!,
        demand: demandById.get(p.id) ?? { wantCount: 0, recentCount: 0 },
        commerce: {
          purchasable: Boolean(p.purchasable),
          soldOut: p.inventory_status === "out_of_stock",
          pickupEnabled: fulfillment.some((f) => f.product_id === p.id && f.method === "pickup"),
          pickupPrice: String(fulfillment.find((f) => f.product_id === p.id && f.method === "pickup")?.price ?? ""),
          eventPickupIds: fulfillment.filter((f) => f.product_id === p.id && f.method === "event_pickup" && f.appearance_id).map((f) => f.appearance_id!),
        },
      };
    });
  };

  // ── One round trip for everything this destination needs ──────────────
  // Every read below is independent of the others (the few that depend on an
  // earlier result chain inside their own loader), so they all start together.
  // A destination that needs none of a given group pays nothing for it.
  const countProducts = async () => {
    const { count } = await admin
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("business_id", id)
      .is("archived_at", null)
      .is("trashed_at", null);
    return count ?? 0;
  };
  const growthTrio = () => Promise.all([getBrandAudit(id), getIdeasForBusiness(id), getBusinessGoals(id)]);
  const schedulePromise = whenP(needsSchedule || needsHosted, loadSchedule, undefined);
  // Relationship workspace (lib/business-relationships.ts) for a place, or the
  // Target workspace for a Business / Event Target. Target reads never select
  // internal_notes; those are read only for a founder Admin session. Activity is
  // read only for the opened Target (first page) — never for a list.
  const workspacePromise = whenP(
    wantsWorkspace,
    async () => {
      const opened = requestedLoc ? null : await getBusinessTarget(admin, id, requestedTgt || legacyPt);
      const locationId = requestedLoc || opened?.locationId || "";
      if (!locationId) {
        if (!opened) return null;
        const findmiAdmin = isAdminElevated || (await isAdminSession());
        const [internalNotes, activity, inquiries, opportunities] = await Promise.all([
          findmiAdmin ? adminGetTargetInternalNotes(admin, id, opened.id) : null,
          getTargetActivityPage(admin, id, opened.id, null),
          getTargetInquiries(admin, id, opened.id),
          contextualOpportunities(admin, id, opened.kind, opened.counterparty.id),
        ]);
        return { kind: "target" as const, target: opened, findmiAdmin, internalNotes, activity, inquiries, opportunities, scopeLabel: null };
      }
      const data = await getRelationshipWorkspace(admin, id, locationId);
      if (!data) return null;
      const findmiAdmin = Boolean(data.target) && (isAdminElevated || (await isAdminSession()));
      const [internalNotes, activity, scope, inquiries] = await Promise.all([
        data.target && findmiAdmin ? adminGetTargetInternalNotes(admin, id, data.target.id) : null,
        data.target ? getTargetActivityPage(admin, id, data.target.id, null) : null,
        onFindUsMarkets && marketKey && marketKey !== "none" ? resolveGeographyScope(admin, marketKey, areaKey) : null,
        data.target ? getTargetInquiries(admin, id, data.target.id) : [],
      ]);
      return { kind: "place" as const, data, findmiAdmin, internalNotes, activity, inquiries, scopeLabel: scope?.label ?? null };
    },
    null
  );
  // Targets list — private business_targets pipeline (lib/business-targets.ts); not read while a workspace is open.
  // Find Us Here's lens reads Place Targets only.
  const targetsPromise = whenP(
    onTargets,
    async () => ((await workspacePromise) ? null : getBusinessTargetsPage(admin, id, targetsFilter, Number(rawSearchParams.tp) || 1, { placesOnly: onFindUsTargets })),
    null
  );
  const growingInPromise = whenP(onGrowthTargets && !wantsWorkspace, () => getGrowingIn(admin, id), [] as Awaited<ReturnType<typeof getGrowingIn>>);
  // Home → Requests: Commercial Inquiries routed to this Business, still unanswered.
  const inquiryRequestsPromise = whenP(onHome, () => getInboundInquiryRequests(admin, id), [] as Awaited<ReturnType<typeof getInboundInquiryRequests>>);
  // Home → Follow-Ups: this Business's Targets with a next step (one bounded read).
  const followUpTargetsPromise = whenP(onHome, () => getFollowUpTargets(admin, id), [] as Awaited<ReturnType<typeof getFollowUpTargets>>);
  // Commercial Discovery: one bounded, server-filtered page (lib/discovery/commercial-server.ts).
  const discoverPromise = whenP(
    onDiscover,
    () => getCommercialDiscovery(admin, id, parseCommercialQuery({ market: rawSearchParams.dm, area: rawSearchParams.da, entity: rawSearchParams.de, category: rawSearchParams.dc, q: rawSearchParams.dq, page: rawSearchParams.dp })),
    null as Awaited<ReturnType<typeof getCommercialDiscovery>> | null
  );
  // Growth's one-line Targets status (two head counts).
  const targetsPursuitPromise = whenP(needsGrowth, () => getTargetPursuit(admin, id), { total: 0, pursuing: 0 });
  const marketsPromise = whenP(onHome || onSettings, loadMarkets, noMarkets);
  const galleryPromise = rowsWhen(onHome, () =>
    admin.from("business_images").select("url").eq("business_id", id).order("display_order", { ascending: true, nullsFirst: false })
  );
  // Photos edits the saved gallery as a whole list (a save replaces it), so
  // a failed read must never look like an empty gallery: null = couldn't
  // load, and the Photos view then offers no Save.
  const photosPromise = whenP(
    onGallery,
    async () => {
      const { data, error: readError } = await admin
        .from("business_images")
        .select("url")
        .eq("business_id", id)
        .order("display_order", { ascending: true, nullsFirst: false });
      return readError || !data ? null : data.map((r) => r.url as string);
    },
    null as string[] | null
  );
  // Command Center V1 — Home's dashboard view-model resolves the Appearances
  // above (standalone AND Event-linked alike) into one flat, presentation-ready
  // list, plus this business's own "Area · Market" label — see
  // lib/business-dashboard.ts. It needs only the schedule, the primary Market
  // and the gallery fallback imagery, so it chains behind exactly those and
  // overlaps every other Home read instead of waiting for the slowest of them.
  const dashboardPromise = whenP(
    onHome,
    async () => {
      await schedulePromise;
      const { primaryMarket: homeMarket } = await marketsPromise;
      const homeGallery = (await galleryPromise).map((r) => r.url);
      return resolveDashboardAppearances(
        admin,
        id,
        // Home's Happening now / Coming up show one card per real-world
        // participation; the Where I'll Be management list keeps every row.
        canonicalOwnerAppearances(appearances, eventIdsWithOccurrenceProjections) as DashboardAppearanceSource[],
        { primaryMarketId: homeMarket?.marketId ?? null, marketAreaId: business.market_area_id ?? null },
        // Same image fallback the public Appearance cards use (flyer → Event
        // cover → gallery → cover), then the logo.
        { galleryImages: homeGallery, coverUrl: business.cover_image_url, logoUrl: business.logo_url }
      );
    },
    { appearances: [], businessGeographyLabel: null } as Awaited<ReturnType<typeof resolveDashboardAppearances>>
  );
  const [
    categories,
    categoryRows,
    ,
    businessHandle,
    qrByEntity,
    referralPartner,
    followerSummary,
    markets,
    orderSummary,
    orderList,
    openOrder,
    moreProductCount,
    businessLocationsView,
    pendingInvitations,
    recommendedOpportunities,
    growthData,
    ownerAvailability,
    productSetsData,
    marketOverview,
    marketDetail,
    businessMoments,
    exploreData,
    pastAppearances,
    performanceData,
    businessQrCampaigns,
    ,
    ,
    dashboardResult,
  ] = await Promise.all([
    whenP(onProfile || onProducts, () => getCategories(), [] as Awaited<ReturnType<typeof getCategories>>),
    rowsWhen(onProfile || onHome, () => admin.from("business_categories").select("category_id").eq("business_id", id).order("category_id").limit(1)),
    // Existing gallery table (business_images) — read for Home, whose cards
    // fall back to it for imagery (through dashboardPromise above). Photos
    // reads its own copy (photosPromise).
    galleryPromise,
    whenP(onHome, () => getEntityHandle(admin, "business", id), null as Awaited<ReturnType<typeof getEntityHandle>>),
    whenP(onUpcoming || onProducts, loadQrByEntity, {
      qrCampaignsByAppearanceId: new Map<string, { id: string; name: string; scans: number }[]>(),
      qrCampaignsByProductId: new Map<string, { id: string; name: string; scans: number }[]>(),
    }),
    referralPromise,
    // User Identity + Follow Foundation pass — Home's pulse and Performance's
    // Audience section.
    whenP(onHome || onPerformance, () => getBusinessFollowerSummary(admin, id), {
      totalCount: 0,
      accountCount: 0,
      legacyCount: 0,
      newLast30Days: 0,
    } as Awaited<ReturnType<typeof getBusinessFollowerSummary>>),
    marketsPromise,
    whenP(onHome || onOrders || (onMore && pro), () => getBusinessOrderSummary(admin, id), noOrderSummary),
    whenP(onOrders, () => getBusinessOrderList(admin, id, orderStatus), [] as Awaited<ReturnType<typeof getBusinessOrderList>>),
    whenP(onOrders && Boolean(openOrderId), () => getBusinessOrderDetail(admin, openOrderId as string, id), null as Awaited<ReturnType<typeof getBusinessOrderDetail>>),
    whenP(onMore && pro, countProducts, 0),
    whenP(onLocations, loadBusinessLocationsView, null as Awaited<ReturnType<typeof loadBusinessLocationsView>> | null),
    // Opportunities Cleanup Pass A — only Home's "N Event Invitation(s)" tile
    // count needs the Event invitations now.
    whenP(onHome, () => getPendingInvitationsForBusiness(admin, id), [] as OpportunityListItem[]),
    // Business-Facing Opportunities — commercial Opportunities Findmi
    // recommended to THIS Business (a separate system from the Event
    // invitations). Business-safe items only; any member role may view.
    whenP(needsGrowth, () => getBusinessOpportunityItems(id), { active: [], past: [] } as Awaited<ReturnType<typeof getBusinessOpportunityItems>>),
    // Growth Setup summary + Opportunity goals + Ideas. Home's mini-dashboard,
    // the hub navigation badges and every Growth view read the SAME summary, so
    // all three load wherever it is shown. Each tolerates its migration not
    // being applied yet (available: false).
    whenP(needsGrowth, growthTrio, [null, { available: false, ideas: [] }, { available: false, goals: [] }] as unknown as Awaited<ReturnType<typeof growthTrio>>),
    // Findmi Here → Find Us Here (owner view; every status). Fails safe to
    // { available: false } until the details migration is applied.
    whenP(onFindUsPlaces, () => getOwnerAvailabilityPage(admin, id, findUsFilter, Number(rawSearchParams.fp) || 1), { available: false, items: [], total: 0, page: 1, pageSize: 50, counts: { all: 0, live: 0, pending: 0, declined: 0, imported: 0 } } as Awaited<ReturnType<typeof getOwnerAvailabilityPage>>),
    // Product Sets feed the Find Us Here Products chooser (template layer).
    whenP(onFindUsPlaces || wantsWorkspace, () => getProductSets(admin, id), { available: false, sets: [] } as Awaited<ReturnType<typeof getProductSets>>),
    // Find Us Here → By Market (a separate view of the same footprint, grouped by Market).
    // By Market — the geography lens over the same relationships (shared reader + scope helper).
    whenP(onFindUsMarkets && !marketKey && !wantsWorkspace, () => getGeographyOverview(admin, id), null as Awaited<ReturnType<typeof getGeographyOverview>> | null),
    whenP(
      onFindUsMarkets && Boolean(marketKey) && !wantsWorkspace,
      async () => {
        const scope = marketKey === "none" ? ("none" as const) : await resolveGeographyScope(admin, marketKey, areaKey);
        return scope ? getGeographyDetail(admin, id, scope) : null;
      },
      null as Awaited<ReturnType<typeof getGeographyDetail>> | null
    ),
    whenP(
      activeTab === "moments",
      () => getBusinessMoments(id, { viewerUserId: user?.id ?? null, withDisplay: true }),
      emptyMoments as Awaited<ReturnType<typeof getBusinessMoments>>
    ),
    whenP(activeTab === "opportunities" && opportunityView === "explore", () => getExploreItems(id, exploreFilters), null as Awaited<ReturnType<typeof getExploreItems>> | null),
    whenP(onPast, () => getPastAppearancesForBusiness(id, 30), [] as Awaited<ReturnType<typeof getPastAppearancesForBusiness>>),
    // Home reads its Performance pulse itself, streamed (v2/HomePerformance.tsx).
    whenP(onPerformance && pro, () => getOwnerBusinessPerformance(admin, id, perfRange), null as Awaited<ReturnType<typeof getOwnerBusinessPerformance>> | null),
    // QR tab — every campaign this Business owns, grouped by lifecycle.
    whenP(activeTab === "qr" || onPerformance, () => getBusinessQrCampaigns(admin, id), [] as Awaited<ReturnType<typeof getBusinessQrCampaigns>>),
    // The schedule/hosted reads, and the Products list, load their own
    // outer state (see loadSchedule / loadProducts above).
    schedulePromise,
    whenP(onProducts || onFindUs || wantsWorkspace, loadProducts, undefined),
    dashboardPromise,
  ]);
  const { qrCampaignsByAppearanceId, qrCampaignsByProductId } = qrByEntity;
  const [workspace, targetsList, targetsPursuit, growingIn, followUpTargets, discovery, inquiryRequests] = await Promise.all([workspacePromise, targetsPromise, targetsPursuitPromise, growingInPromise, followUpTargetsPromise, discoverPromise, inquiryRequestsPromise]);
  // Public Actions settings (Profile) — only read on that tab.
  const [publicActionsEditor, fieldStatus] = await Promise.all([
    onProfile && admin ? getPublicActionsEditorData(admin, "business", id) : Promise.resolve(null),
    onProfile ? readBusinessFieldStatus(admin, id) : Promise.resolve({}),
  ]);
  const { primaryMarket, additionalMarkets, marketLimit, activeMarketCount, overMarketAllowance, pendingMarketRequest } = markets;
  const [brandAudit, opportunityIdeas, growthGoals] = growthData;
  const currentCategoryId = categoryRows[0]?.category_id ?? "";
  const photos = await photosPromise;
  const growthSummary = needsGrowth
    ? growthSummaryFor({
        audit: brandAudit?.available ? brandAudit.summary : null,
        activeGoalCount: growthGoals.goals.filter((g) => g.status === "active").length,
        opportunityItems: [...recommendedOpportunities.active, ...recommendedOpportunities.past],
        ideas: opportunityIdeas.ideas,
        targets: targetsPursuit,
      })
    : null;
  // One Targets list for both doors (Find Us Here and Growth): same records, same actions.
  const targetsView = targetsList ? (
    <TargetsView
      businessId={id}
      available={targetsList.available}
      items={targetsList.items}
      total={targetsList.total}
      page={targetsList.page}
      pageSize={targetsList.pageSize}
      counts={targetsList.counts}
      kindCounts={targetsList.kindCounts}
      filter={targetsFilter}
      canEdit={canEditTargets(membershipRole, isAdminElevated)}
      openMissing={wantsWorkspace && !workspace}
      placesOnly={onFindUsTargets}
      discoverHref={onGrowthTargets ? `/account/business/${id}?tab=growth&view=discover` : undefined}
      context={
        // Growth door only (growingIn is read only there).
        growingIn.length > 0 ? (
          <nav aria-label="Growing In" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-metadata">
            <span className="font-semibold text-muted">Growing In</span>
            {growingIn.map((g) => (
              <Link key={`${g.marketSlug}/${g.areaSlug ?? ""}`} href={`/account/business/${id}?tab=findmi-here&view=find-us&fv=markets&fm=${g.marketSlug}${g.areaSlug ? `&fa=${g.areaSlug}` : ""}`} className="inline-flex min-h-9 items-center font-semibold text-accent hover:underline">
                {g.label} →
              </Link>
            ))}
          </nav>
        ) : null
      }
    />
  ) : null;
  // Arriving from a public action (…&inquire=<intent>): the composer opens on that intent.
  const inquireIntent = typeof rawSearchParams.inquire === "string" && isCommercialIntent(rawSearchParams.inquire) ? rawSearchParams.inquire : null;
  // One relationship workspace for every door; Back returns to the lens it was opened from.
  // A validated origin (?from=discover / search / inbox…) wins over the lens.
  const workspaceOrigin = originBack(id, rawSearchParams.from);
  const workspaceBack = (() => {
    if (workspaceOrigin) return workspaceOrigin.href;
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(rawSearchParams)) if (typeof v === "string" && k !== "loc" && k !== "pt" && k !== "tgt" && k !== "inquire" && k !== "from") q.set(k, v);
    return `/account/business/${id}?${q.toString()}`;
  })();
  const workspaceView = workspace?.kind === "target" ? (
    <TargetWorkspace
      businessId={id}
      target={workspace.target}
      canEdit={canEditTargets(membershipRole, isAdminElevated)}
      isFindmiAdmin={workspace.findmiAdmin}
      internalNotes={workspace.internalNotes}
      activity={workspace.activity}
      inquiries={workspace.inquiries}
      senderName={business.name}
      opportunities={workspace.opportunities}
      initialInquiryIntent={inquireIntent}
      backHref={workspaceBack}
      backLabel={workspaceOrigin?.label ?? "Targets"}
    />
  ) : workspace ? (
    <RelationshipWorkspace
      businessId={id}
      data={workspace.data}
      canEdit={canEditTargets(membershipRole, isAdminElevated)}
      isFindmiAdmin={workspace.findmiAdmin}
      internalNotes={workspace.internalNotes}
      activity={workspace.activity}
      inquiries={workspace.inquiries}
      initialInquiryIntent={inquireIntent}
      senderName={business.name}
      backHref={workspaceBack}
      backLabel={workspaceOrigin ? workspaceOrigin.label : onTargets ? "Targets" : onFindUsMarkets ? (workspace.scopeLabel ?? "By Market") : "Places"}
      products={products.map((p) => ({ id: p.id, name: p.name }))}
      productSets={productSetsData.sets}
      productSetsAvailable={productSetsData.available}
    />
  ) : null;
  const requestPayoutAction = referralPartner
    ? requestReferralPartnerPayout.bind(null, id, referralPartner.id)
    : null;

  // Legacy categories stay in the DB for existing relationships but are no
  // longer offered as a new choice — except for a business already
  // assigned to one, so editing this page can never silently drop it.
  const selectableCategories = categories.filter(
    (c) => !LEGACY_BUSINESS_CATEGORY_SLUGS.has(c.slug) || c.id === currentCategoryId
  );

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
  const { appearances: dashboardAppearances, businessGeographyLabel } = dashboardResult;
  // Pass A — the same id-based integrity rule for Presence → Upcoming:
  // a superseded Event-level projection (e.g. Lavazza TABLÌ) isn't listed
  // beside its per-date rows. Display only; records untouched.
  // Business-Hosted Events V1 — a hosted Event's Event-level projection
  // (participation-derived, not one the owner typed in manually) is already
  // represented by its Hosting row; date-level and manual rows stay.
  const presenceAppearances = canonicalAppearances.filter(
    (a) => !(a.event_id && hostedEventIds.has(a.event_id) && !a.event_occurrence_id && a.source !== "manual")
  );
  // Home is a summary (presentation grouping, not counting): one live card
  // / Coming Up row per Event or standalone Appearance, with "+ N More
  // Dates" read from the full (unpaged) schedule.
  // B2 — Coming Up is the Business's actual upcoming activity: its
  // Appearances AND the Events it hosts (events.host_business_id), one item
  // per Event (deduped by Event id — see buildHomeComingUp). A hosted Event
  // shows its cover, else the Business's own imagery; it opens the Event
  // Manager with this Business as context, same as Findmi Here's Hosting row.
  const homeActivities = buildHomeComingUp(
    dashboardAppearances,
    hostedUpcoming.map((h) => ({
      eventId: h.id,
      name: h.name,
      // Home's Coming Up is built on exact times; a hosted date with no
      // published time is listed in the Hosting section instead.
      dates: h.upcomingDates.flatMap((d) => (d.startAt ? [{ startAt: d.startAt, endAt: d.endAt }] : [])),
      where: h.where,
      statusLabel: h.statusLabel,
      imageUrl: h.coverImageUrl ?? business.cover_image_url ?? business.logo_url ?? null,
      href: `/account/event/${h.id}?business_id=${encodeURIComponent(id)}`,
    })),
    countUpcomingDatesPerPreviewGroup(allScheduleRows, eventIdsWithOccurrenceProjections),
    // Home's Coming Up rail shows up to six upcoming items.
    6
  );
  // "Materially affects discovery" — the same fields a visitor would
  // actually need to find/trust this business, not every optional field
  // on the Profile tab (e.g. website/social links are never required here).
  // VCL A2b — City/State are optional for a Business (no geography beats
  // false geography), so their absence alone never flags Complete Profile.
  // Final Brand Build V1 UX cleanup — a Brand reviews only About at
  // onboarding (no Short Description), so either description counts here.
  const profileIncomplete = !business.logo_url || !(business.short_description || business.description) || !currentCategoryId;
  const needsAttention = buildNeedsAttentionItems({
    businessId: id,
    upcomingAppearances: dashboardAppearances,
    profileIncomplete,
    missingProfile: {
      logo: !business.logo_url,
      description: !(business.short_description || business.description),
      category: !currentCategoryId,
    },
  });
  // Home → Requests (lib/business-requests.ts): sent TO this Business and
  // waiting on it — composed from rows this page already read, no new query.
  const requests = onHome
    ? buildBusinessRequests({
        basePath: `/account/business/${id}`,
        opportunities: recommendedOpportunities.active.map((i) => ({
          recipientId: i.view.recipientId,
          title: i.view.opportunity.title,
          group: i.view.group,
          placeName: i.place?.name ?? null,
          offeredAt: i.view.offeredAt,
        })),
        invitations: pendingInvitations,
        newOrderCount: orderSummary.newCount,
        inquiries: inquiryRequests,
      })
    : [];
  // Home → Follow-Ups (lib/business-follow-ups.ts): Targets only.
  const followUps = onHome ? buildFollowUps({ basePath: `/account/business/${id}`, targets: followUpTargets, today: followUpToday() }) : [];


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
    (moreProductCount > 0 ||
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

  return (
    // The persistent shell (identity, switcher, navigation) is the layout
    // above this page; this returns the content view only.
    <>
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

            {/* B1 — publication status (incl. Pending Review + Preview) now
                renders inside BusinessHome's compact Status row. */}
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
              businessSlug={business.slug ?? null}
              publicationStatus={business.publication_status}
              pro={pro}
              liveActivities={homeActivities.live}
              comingUp={homeActivities.comingUp}
              needsAttention={needsAttention}
              requests={requests}
              followUps={followUps}
              inboxExpanded={[rawSearchParams.inbox, rawSearchParams.followups, rawSearchParams.requests].includes("all")}
              performanceRange={perfRange}
              followers={followerSummary.totalCount}
              businessHandle={businessHandle}
              updateHandleAction={updateBusinessHandle.bind(null, id)}
              growth={growthSummary!}
            />
          </div>
        )}

        {/* ── Growth ───────────────────────────────────────────────── */}
        {activeTab === "growth" && growthSummary && growthView === "goals" && (
          <GrowthGoalsView
            basePath={basePath}
            businessId={id}
            audit={brandAudit?.available ? brandAudit.summary : null}
            profile={brandAudit?.available ? brandAudit : null}
            summary={growthSummary}
            goals={growthGoals}
            canManage={canManageOpportunityGoals}
            manageNote={goalManageNote}
            notice={goalNotice}
          />
        )}
        {activeTab === "growth" && growthSummary && growthView === "targets" && workspaceView}
        {activeTab === "growth" && growthSummary && growthView === "targets" && !workspaceView && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 lg:max-w-3xl">
              <GrowthTargetsHeader basePath={basePath} summary={growthSummary} />
            </div>
            {targetsView}
          </div>
        )}
        {activeTab === "growth" && growthSummary && growthView === "discover" && discovery && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 lg:max-w-3xl">
              <GrowthTargetsHeader basePath={basePath} summary={growthSummary} />
            </div>
            <DiscoverView businessId={id} data={discovery} canEdit={canEditTargets(membershipRole, isAdminElevated)} targetsHref={`${basePath}?tab=growth&view=targets`} />
          </div>
        )}
        {activeTab === "growth" && growthSummary && growthView === "ideas" && (
          <GrowthIdeasView
            basePath={basePath}
            summary={growthSummary}
            ideas={opportunityIdeas.ideas}
            canRespondToIdeas={canManageOpportunityGoals}
            respondToIdea={respondToIdeaAction.bind(null, id)}
          />
        )}

        {/* ── Moments ──────────────────────────────────────────────── */}
        {activeTab === "moments" && <MomentsView basePath={basePath} businessId={id} data={businessMoments} filter={momentFilter} canPost={isManagingRole(membershipRole) || isAdminElevated} canManageDisplay={isManagingRole(membershipRole) || isAdminElevated} />}

        {/* ── Performance ──────────────────────────────────────────── */}
        {/* Free/Pro Entitlement Realignment pass — Analytics (including
            the Audience section inside PerformanceTab) is Pro-only again,
            same UpgradeLockedTab pattern as every other Pro-gated tab on
            this page. PerformanceTab/getOwnerBusinessPerformance
            themselves are completely unchanged — only this gate moved. */}
        {activeTab === "performance" && (
          <>
            <PerformanceViewTabs basePath={basePath} view="overview" />
            <QrSnapshot basePath={basePath} campaigns={businessQrCampaigns} />
            {pro && performanceData ? (
              <PerformanceTab
                data={performanceData}
                basePath={basePath}
                range={perfRange}
                businessId={id}
                businessName={business.name}
                businessSlug={business.slug ?? null}
                followerSummary={followerSummary}
              />
            ) : (
              <UpgradeLockedTab
                businessId={id}
                tabKey="performance"
                description="Understand how people discover and engage with your business."
                isAdminElevated={isAdminElevated}
              />
            )}
          </>
        )}

        {/* ── QR Codes (a view of Performance) ─────────────────────── */}
        {/* The one Business Manager QR destination: creation (Create QR
            Code → the creator at /qr/new) and every campaign this
            Business owns (qr_campaigns.business_id), searchable and
            filterable, grouped by lifecycle. Detail lives at the
            unchanged /account/qr/[id]. Free-tier reachable (see
            qr-actions.ts on why QR creation is never plan-gated).
            Event/Location campaigns have no business_id (that ownership
            is independent — see lib/permissions.ts), so they stay
            reachable from that Event's/Location's own manager page. The
            old /qr Campaign Manager URL redirects here. */}
        {activeTab === "qr" && (
          <>
            <PerformanceViewTabs basePath={basePath} view="qr" />
            <QrCodesView basePath={basePath} campaigns={businessQrCampaigns} />
          </>
        )}

        {/* ── Profile ──────────────────────────────────────────────── */}
        {activeTab === "profile" && (
          <div className="flex flex-col gap-4 lg:max-w-5xl">
          {/* Public Profile — the ONE place to manage what people see when they
              find this Business: details, Public Actions, Announcement,
              photos and links. How inquiries work stays in Inquiry Settings. */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h1 className="font-display text-page-title sm:text-page-title-lg font-bold text-primary">Public Profile</h1>
            {business.slug && (
              <Link href={`/business/${business.slug}`} className="flex min-h-10 items-center gap-1 text-metadata font-bold text-accent hover:underline">
                View Public Page
                <ChevronIcon direction="right" className="h-3 w-3" />
              </Link>
            )}
          </div>
          <ProfileSectionNav businessId={id} current="profile" />
          {/* ?tab=profile&created=1 shows the same confirmation the
              Overview shows (Brand onboarding now completes on Account
              Home — /account?created=<id>, VCL A2). */}
          {created && (
            <p className="max-w-2xl rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-body text-accent">
              Business created! Add your links below, and your logo and photos in{" "}
              <Link href={managerHref(id, "gallery")} className="font-bold underline underline-offset-2">
                Photos
              </Link>
              , to finish your profile.
            </p>
          )}
          <Panel id="details" title="Details" meta={<span className="text-metadata text-subtle">What customers see</span>}>
            <form action={profileAction} className="flex flex-col gap-4">
              <UnsavedChangesGuard />
              <label className="block">
                <span className="mb-1.5 block text-body font-medium text-primary">Business name</span>
                <input autoCapitalize="words" type="text" name="name" required defaultValue={business.name} className={inputClass} />
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
                <textarea autoCapitalize="sentences"
                  name="short_description"
                  rows={3}
                  defaultValue={business.short_description ?? ""}
                  className={inputClass}
                />
              </label>
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
                  <input autoCapitalize="words" type="text" name="city" defaultValue={business.city ?? ""} className={inputClass} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-body font-medium text-primary">State</span>
                  <input autoCapitalize="words" type="text" name="state" defaultValue={business.state ?? ""} className={inputClass} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-body font-medium text-primary">ZIP Code</span>
                  <input autoCapitalize="none" type="text" name="postal_code" defaultValue={business.postal_code ?? ""} className={inputClass} />
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
                <textarea autoCapitalize="sentences"
                  name="description"
                  rows={5}
                  defaultValue={business.description ?? ""}
                  className={inputClass}
                />
              </label>
              {/* Free/Pro Entitlement Realignment pass — country is a
                  regular Free field now (PROFILE_FREE_COLUMNS in
                  ../actions.ts authorizes the write for both tiers), so
                  it's always rendered here regardless of plan, same
                  presentation-follows-authorization pattern as
                  city/state/ZIP/About above. */}
              <label className="block">
                <span className="mb-1.5 block text-body font-medium text-primary">Country</span>
                <input autoCapitalize="words" type="text" name="country" defaultValue={business.country ?? ""} className={inputClass} />
              </label>

              <button type="submit" className={`mt-1 ${primaryButtonClass}`}>
                Save Details
              </button>
            </form>
          </Panel>

          {/* ── Photos — Logo, Cover and Gallery have one home: the Photos
              destination (?tab=gallery). ── */}
          <Panel id="photos" title="Photos" meta={<span className="text-metadata text-subtle">Logo, cover &amp; gallery</span>}>
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-black/[0.08] bg-findmi-50 text-findmi-700">
                {business.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- small preview of the stored logo
                  <img src={business.logo_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-5 w-5">
                    <rect x="3.5" y="5" width="17" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
                    <circle cx="9" cy="10" r="1.6" fill="currentColor" />
                    <path d="m5 17 4.5-4.5 3 3 2.5-2.5L19 17" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <p className="min-w-0 flex-1 text-metadata text-muted">Your logo, cover image and photo gallery.</p>
              <Link href={managerHref(id, "gallery")} className="flex h-9 shrink-0 items-center rounded-full border border-findmi-200 bg-findmi-50 px-3.5 text-metadata font-bold text-findmi-700 hover:bg-findmi-100">
                Edit Photos
              </Link>
            </div>
          </Panel>

          {/* ── Contact & Links — every outbound way to reach this Business.
              Each saved value shows whether it's on the public profile:
              Findmi reviews new or changed links before they show
              (lib/profile-visibility.ts). ── */}
          <div className="lg:max-w-2xl">
            <Panel id="links" title="Contact & Links">
              <form action={linksAction} className="flex flex-col gap-4">
                <UnsavedChangesGuard />
                <input type="hidden" name="section" value="links" />
                <p className="text-metadata text-muted">New or changed links show on your profile once Findmi reviews them.</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 flex items-center justify-between gap-2 text-body font-medium text-primary">
                      Website
                      {business.website_url && <VisibilityChip status={fieldVisibility(fieldStatus, "website_url")} />}
                    </span>
                    <input autoCapitalize="none"
                      type="url"
                      name="website_url"
                      defaultValue={business.website_url ?? ""}
                      placeholder="https://…"
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 flex items-center justify-between gap-2 text-body font-medium text-primary">
                      Instagram
                      {business.instagram_url && <VisibilityChip status={fieldVisibility(fieldStatus, "instagram_url")} />}
                    </span>
                    <input autoCapitalize="none"
                      type="url"
                      name="instagram_url"
                      defaultValue={business.instagram_url ?? ""}
                      placeholder="https://instagram.com/…"
                      className={inputClass}
                    />
                  </label>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 flex items-center justify-between gap-2 text-body font-medium text-primary">
                      Email
                      {business.email && <VisibilityChip status={fieldVisibility(fieldStatus, "email")} />}
                    </span>
                    <input autoCapitalize="none"
                      type="email"
                      name="email"
                      defaultValue={business.email ?? ""}
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 flex items-center justify-between gap-2 text-body font-medium text-primary">
                      Phone
                      {business.phone && <VisibilityChip status={fieldVisibility(fieldStatus, "phone")} />}
                    </span>
                    <input autoCapitalize="none"
                      type="tel"
                      name="phone"
                      defaultValue={business.phone ?? ""}
                      className={inputClass}
                    />
                  </label>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 flex items-center justify-between gap-2 text-body font-medium text-primary">
                      Facebook
                      {business.facebook_url && <VisibilityChip status={fieldVisibility(fieldStatus, "facebook_url")} />}
                    </span>
                    <input autoCapitalize="none"
                      type="url"
                      name="facebook_url"
                      defaultValue={business.facebook_url ?? ""}
                      placeholder="https://facebook.com/…"
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 flex items-center justify-between gap-2 text-body font-medium text-primary">
                      TikTok
                      {business.tiktok_url && <VisibilityChip status={fieldVisibility(fieldStatus, "tiktok_url")} />}
                    </span>
                    <input autoCapitalize="none"
                      type="url"
                      name="tiktok_url"
                      defaultValue={business.tiktok_url ?? ""}
                      placeholder="https://tiktok.com/@…"
                      className={inputClass}
                    />
                  </label>
                </div>
                <button type="submit" className={`mt-1 ${primaryButtonClass}`}>
                  Save Contact &amp; Links
                </button>
              </form>
            </Panel>
          </div>

          {/* ── Announcement — a temporary update on the profile (content,
              not a button). Its own form; reviewed like links. ── */}
          <div className="lg:max-w-2xl">
            <Panel
              id="announcement"
              title="Announcement"
              meta={bulletinFingerprint(business) ? <VisibilityChip status={fieldVisibility(fieldStatus, "bulletin")} /> : undefined}
            >
              <form action={linksAction} className="flex flex-col gap-4">
                <UnsavedChangesGuard />
                <input type="hidden" name="section" value="announcement" />
                <p className="text-metadata text-muted">Share a temporary update on your profile. Buttons visitors can tap are set in Profile Buttons.</p>
                <div className="rounded-2xl border border-black/10 p-4 has-[input[name=bulletin_enabled]:not(:checked)]:[&_.announcement-fields]:pointer-events-none has-[input[name=bulletin_enabled]:not(:checked)]:[&_.announcement-fields]:opacity-40">
                  <label className="flex items-center gap-2 text-body font-medium text-primary">
                    <input type="checkbox" name="bulletin_enabled" defaultChecked={business.bulletin_enabled} />
                    Show announcement
                  </label>
                  <div className="announcement-fields mt-3 flex flex-col gap-3 transition-opacity">
                    <label className="block">
                      <span className="mb-1.5 block text-body font-medium text-primary">Announcement label</span>
                      <input autoCapitalize="words"
                        type="text"
                        name="bulletin_label"
                        defaultValue={business.bulletin_label ?? ""}
                        placeholder="Announcement"
                        className={inputClass}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-body font-medium text-primary">Announcement heading</span>
                      <input autoCapitalize="words"
                        type="text"
                        name="bulletin_heading"
                        defaultValue={business.bulletin_heading ?? ""}
                        className={inputClass}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-body font-medium text-primary">Announcement message</span>
                      <textarea autoCapitalize="sentences"
                        name="bulletin_body"
                        rows={3}
                        defaultValue={business.bulletin_body ?? ""}
                        className={inputClass}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-body font-medium text-primary">Announcement link (optional)</span>
                      <input autoCapitalize="none"
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
                  Save Announcement
                </button>
              </form>
            </Panel>
          </div>

          {/* ── Profile Buttons — what visitors can DO from this profile: the
              ONE source of the buttons under its identity (up to 3). How
              inquiries work stays in Inquiry Settings. ── */}
          {publicActionsEditor && (
            <div className="flex max-w-2xl flex-col gap-3">
              <PublicActionsEditor
                kind="business"
                entityId={id}
                ready={publicActionsEditor.ready}
                opportunities={publicActionsEditor.opportunities}
                initial={publicActionsEditor.configured}
                unavailable={{
                  ...(pro && business.accepts_inquiries && sanitizeBusinessInquiryTopics(business.inquiry_topics).length > 0 ? {} : { general_inquiry: "Turn on Inquiries to use this action." }),
                  ...(business.website_url ? {} : { website: "Add your website in Contact & Links to use this action." }),
                }}
                inquirySettingsHref={`${basePath}?tab=inquiries`}
              />
              <div className="rounded-2xl border border-black/[0.08] bg-white">
                <Row
                  label="Inquiry Settings"
                  value={
                    <span className="inline-flex items-center gap-1">
                      {business.accepts_inquiries && sanitizeBusinessInquiryTopics(business.inquiry_topics).length > 0 ? "Enabled" : "Off"}
                      <ChevronIcon direction="right" className="h-3 w-3" />
                    </span>
                  }
                  href={`${basePath}?tab=inquiries`}
                />
              </div>
            </div>
          )}
          </div>
        )}

        {/* ── Photos ───────────────────────────────────────────────── */}
        {/* Photos (?tab=gallery) — the Business gallery as its own
            destination (it had been a panel inside Public Profile). Same
            business_images list and updateBusinessGallery save, now with
            reordering; the save returns here with Saved. or its error. */}
        {activeTab === "gallery" && (
          <div className="flex flex-col gap-4 lg:max-w-3xl">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="font-display text-page-title sm:text-page-title-lg font-bold text-primary">Photos</h1>
                <p className="mt-0.5 text-body text-muted">Your logo, cover image and the photos on your public page.</p>
              </div>
              {business.slug && (
                <Link href={`/business/${business.slug}`} className="flex min-h-10 shrink-0 items-center gap-1 text-metadata font-bold text-accent hover:underline">
                  View Public Page
                  <ChevronIcon direction="right" className="h-3 w-3" />
                </Link>
              )}
            </div>
            <ProfileSectionNav businessId={id} current="gallery" />
            <section aria-labelledby="logo-cover-title" className={cardClass}>
              <h2 id="logo-cover-title" className="font-display text-card-title font-bold text-primary">
                Logo &amp; Cover
              </h2>
              <form action={brandImagesAction} className="mt-3 flex flex-col gap-4">
                <UnsavedChangesGuard />
                <MemberImageField businessId={id} label="Logo" name="logo_url" defaultValue={business.logo_url} />
                <MemberImageField businessId={id} label="Cover image" name="cover_image_url" defaultValue={business.cover_image_url} />
                <button type="submit" className={`self-start ${primaryButtonClass}`}>
                  Save Logo &amp; Cover
                </button>
              </form>
            </section>
            {photos ? (
              <section aria-label="Photo gallery" className={cardClass}>
                <form action={galleryAction}>
                  <MemberGalleryField businessId={id} name="gallery_image_url" initialUrls={photos} />
                </form>
              </section>
            ) : (
              <p className="max-w-2xl rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-body text-red-700">
                We couldn&rsquo;t load your photos right now, so editing is paused to keep your gallery safe. Refresh the page to try again.
              </p>
            )}
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
                  <span className="group-open:hidden">{products.length > 0 ? "+ Add a Product" : "+ Add Your First Product"}</span>
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
                      <li key={p.id} id={`product-${p.id}`} className="scroll-mt-24 px-4 py-3 first:pt-0 last:pb-0">
                        <details open={editing === p.id}>
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
                              {p.demand.wantCount > 0 && (
                                <p className="mt-0.5 truncate text-metadata text-accent">{p.demand.wantCount === 1 ? "1 person wants this" : `${p.demand.wantCount} people want this`}</p>
                              )}
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
                            {/* Catalog vs Marketplace vs Demand — the ONE
                                Marketplace rule's two gates (Findmi
                                approval, checkout readiness) with exact
                                blockers, plus aggregate Want count. Owner
                                transitions only: never "approved"/"paused"
                                (admin/products/actions.ts only). */}
                            <div className="border-t border-black/10 pt-3">
                              <p className="text-label font-semibold uppercase text-subtle">Marketplace</p>
                              <div className="mt-2">
                                {/* Owner state machine (ownerMarketplaceState):
                                    only the action that can succeed is
                                    offered — never a request that's known
                                    to fail. */}
                                {(() => {
                                  const step = ownerMarketplaceState(p.readiness).step;
                                  const actions =
                                    step === "request" || step === "rerequest" ? (
                                      <div className="flex flex-wrap items-center gap-3">
                                        <form action={submitProductToMarketplace.bind(null, id, p.id)}>
                                          <button type="submit" className="h-9 rounded-lg bg-findmi px-3 text-button font-bold text-white transition hover:bg-findmi-600">
                                            {step === "rerequest" ? "Request Review Again" : "Request Marketplace Review"}
                                          </button>
                                        </form>
                                        {step === "rerequest" && (
                                          <form action={returnProductToCatalog.bind(null, id, p.id)}>
                                            <button type="submit" className="text-metadata font-semibold text-subtle hover:underline">
                                              Keep as catalog only
                                            </button>
                                          </form>
                                        )}
                                      </div>
                                    ) : step === "pending" ? (
                                      <form action={returnProductToCatalog.bind(null, id, p.id)}>
                                        <button type="submit" className="text-metadata font-semibold text-muted hover:underline">
                                          Cancel Review Request
                                        </button>
                                      </form>
                                    ) : null;
                                  return <OwnerMarketplacePanel readiness={p.readiness} demand={p.demand} actions={actions} />;
                                })()}
                              </div>

                              {/* Checkout setup — the commerce-readiness
                                  fields the owner controls. */}
                              <details className="mt-3 rounded-xl border border-black/10 bg-white px-3 py-2" open={p.readiness.approved && !p.readiness.commerceReady}>
                                <summary className="cursor-pointer text-metadata font-semibold text-primary">Checkout Setup</summary>
                                <form action={updateMemberProductCommerce.bind(null, id, p.id)} className="mt-2 flex flex-col gap-2 text-metadata text-ink/80">
                                  <label className="flex items-center gap-2">
                                    <input type="checkbox" name="purchasable" defaultChecked={p.commerce.purchasable} className="h-4 w-4" />
                                    Sell through Findmi checkout
                                  </label>
                                  <label className="flex items-center gap-2">
                                    <input type="checkbox" name="sold_out" defaultChecked={p.commerce.soldOut} className="h-4 w-4" />
                                    Sold out
                                  </label>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <label className="flex items-center gap-2">
                                      <input type="checkbox" name="pickup_enabled" defaultChecked={p.commerce.pickupEnabled} className="h-4 w-4" />
                                      Pickup
                                    </label>
                                    <label className="flex items-center gap-1 text-subtle">
                                      fee $
                                      <input
                                        type="number"
                                        name="pickup_price"
                                        min="0"
                                        step="0.01"
                                        inputMode="decimal"
                                        defaultValue={p.commerce.pickupPrice}
                                        placeholder="0"
                                        autoCapitalize="none"
                                        className="h-8 w-20 rounded-lg border border-black/10 px-2 text-base text-ink"
                                      />
                                    </label>
                                  </div>
                                  {productPickupAppearances.length > 0 && (
                                    <fieldset className="flex flex-col gap-1">
                                      <legend className="text-subtle">Event Pickup at</legend>
                                      {productPickupAppearances.map((a) => (
                                        <label key={a.value} className="flex items-center gap-2">
                                          <input type="checkbox" name="event_pickup_appearance_id" value={a.value} defaultChecked={p.commerce.eventPickupIds.includes(a.value)} className="h-4 w-4" />
                                          {a.label}
                                        </label>
                                      ))}
                                    </fieldset>
                                  )}
                                  <p className="text-subtle">
                                    Configure how this product can be purchased. Findmi checkout must also be enabled for your Business
                                    {p.readiness.commerceBlockers.includes("commerce_disabled") ? " (Findmi turns this on — it isn't yet)" : ""} before it
                                    can go live in Marketplace. Shipping and delivery aren&rsquo;t available at checkout yet.
                                  </p>
                                  <button type="submit" className="h-9 w-fit rounded-lg bg-findmi px-3 text-button font-bold text-white transition hover:bg-findmi-600">
                                    Save Checkout Setup
                                  </button>
                                </form>
                              </details>
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
            <PresenceHeader
              basePath={basePath}
              view={presenceView}
              action={presenceView === "upcoming" || presenceView === "past" ? <AddEventChooser basePath={basePath} businessId={id} initialOpen={addParam === ADD_EVENT_PARAM || addParam === "presence"} /> : undefined}
            />
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
                // (Past is built on exact times; an untimed hosted date
                // isn't listed here.)
                ...hostedPast.flatMap((h) => (h.startAt ? [{ ...h, startAt: h.startAt }] : [])).map((h) => ({
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
        {activeTab === "findmi-here" && presenceView === "find-us" && workspaceView}
        {activeTab === "findmi-here" && presenceView === "find-us" && !workspaceView && (
          <div className="mb-4 flex flex-col gap-3">
            <PlacesLens basePath={`/account/business/${id}`} view="find-us" />
            <FindUsViewSwitch basePath={`/account/business/${id}`} active={onFindUsMarkets ? "markets" : "places"} />
          </div>
        )}
        {activeTab === "findmi-here" && presenceView === "find-us" && !workspaceView && onFindUsMarkets && !marketKey && <GeographyOverviewView basePath={`/account/business/${id}`} data={marketOverview} />}
        {activeTab === "findmi-here" && presenceView === "find-us" && !workspaceView && onFindUsMarkets && marketKey && <GeographyDetailView basePath={`/account/business/${id}`} detail={marketDetail} />}
        {activeTab === "findmi-here" && presenceView === "find-us" && !workspaceView && onFindUsTargets && targetsView}
        {activeTab === "findmi-here" && presenceView === "find-us" && !workspaceView && onFindUsPlaces && (
          <AvailableAtView
            businessId={id}
            available={ownerAvailability.available}
            items={ownerAvailability.items}
            total={ownerAvailability.total}
            page={ownerAvailability.page}
            pageSize={ownerAvailability.pageSize}
            counts={ownerAvailability.counts}
            filter={findUsFilter}
            products={products.map((p) => ({ id: p.id, name: p.name }))}
            productSets={productSetsData.sets}
            productSetsAvailable={productSetsData.available}
            canEdit={isManagingRole(membershipRole) || isAdminElevated}
          />
        )}
        {activeTab === "findmi-here" && presenceView === "locations" && (
          <div className="mb-4">
            <PlacesLens basePath={`/account/business/${id}`} view="locations" />
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
        {/* Where We Are → Where We Want To Grow: a compact bridge into
            Growth (the canonical owner of Targets), never a Targets list
            inside current presence. */}
        {activeTab === "findmi-here" && (presenceView === "locations" || (presenceView === "find-us" && !workspaceView)) && (isManagingRole(membershipRole) || isAdminElevated) && (
          <GrowthFootprintBridge businessId={id} />
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
            <p className="text-body text-muted">Events you&rsquo;re hosting and Events you&rsquo;re appearing at. This is what customers see on your public Findmi profile.</p>


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
                    <p className="text-card-title font-bold text-primary">Appearing At An Event</p>
                    <p className="mt-0.5 text-metadata text-muted">An Event or experience someone else is hosting that your Business will participate in.</p>
                  </div>
                  <Link href={`${basePath}?tab=findmi-here`} className="shrink-0 text-metadata font-semibold text-muted hover:text-primary">
                    Close
                  </Link>
                </div>

                {/* Search Findmi first (search-first: nothing listed until
                    the owner types), then Import with the Appearing intent
                    carried through, then manual entry. */}
                {requestOptions.length > 0 ? (
                  <form action={addFromEvent} className="mt-3">
                    <EventSearchPicker options={requestOptions} />
                  </form>
                ) : (
                  <p className="mt-3 text-body text-muted">No upcoming Findmi Events to join right now — import it or add it manually.</p>
                )}

                {/* Event Import V1 — a link, pasted details or a flyer;
                    Findmi fills in the details (participating context). */}
                <Link
                  href={eventImportHref(id, "appearing")}
                  className="mt-3 flex min-h-[48px] items-center justify-between gap-3 rounded-xl border border-black/[0.08] px-3.5 py-2 transition hover:border-findmi/40 hover:bg-findmi-50/40"
                >
                  <span className="min-w-0">
                    <span className="block text-body font-bold text-primary">Import</span>
                    <span className="block text-metadata text-muted">From a link, pasted details or a flyer.</span>
                  </span>
                  <ChevronIcon direction="right" className="h-3.5 w-3.5 shrink-0 text-findmi-700" />
                </Link>

                <AppearanceEditorDetails
                  className="mt-4 border-t border-black/[0.07] pt-3"
                  initialOpen={addHasDraft}
                  summaryClassName="cursor-pointer text-metadata font-semibold text-accent [&::-webkit-details-marker]:hidden"
                  summary="Can’t find it? Add it manually."
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
                      <ScheduleDateBadge iso={h.startAt} date={h.date} live={Boolean(h.startAt && h.endAt && getTemporalLabel(h.startAt, h.endAt).live)} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body font-semibold text-primary">{h.name}</p>
                        <p className="mt-0.5 truncate text-metadata text-muted">
                          {h.startAt ? formatTime(h.startAt) : "Time Not Listed"}
                          {h.startAt && h.endAt && `–${formatTime(h.endAt)}`}
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
                      <div className="flex shrink-0 flex-col items-end">
                        <Link
                          href={`/account/event/${h.id}?business_id=${encodeURIComponent(id)}`}
                          className="inline-flex min-h-9 items-center text-metadata font-semibold text-accent hover:underline"
                        >
                          Manage
                        </Link>
                        {/* Published (no review status) → its public page. */}
                        {!h.statusLabel && (
                          <Link href={eventHref(h.slug)} className="inline-flex min-h-9 items-center text-metadata font-semibold text-muted hover:text-primary hover:underline">
                            View Event
                          </Link>
                        )}
                      </div>
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
                                {/* Same rule as the public schedule map —
                                    a date it can't draw is flagged here. */}
                                {scheduleMapGap(a) && (a.event_id || a.location) && (
                                  <span className="font-semibold text-amber-800"> · {SCHEDULE_MAP_GAP_LABEL[scheduleMapGap(a)!]}</span>
                                )}
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
                    <ScheduleDateBadge iso={e.startAt} date={e.date} live={Boolean(e.startAt && e.endAt && getTemporalLabel(e.startAt, e.endAt).live)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-semibold text-primary">{e.title}</p>
                      <p className="mt-0.5 truncate text-metadata text-muted">
                        {e.startAt ? formatTime(e.startAt) : "Time Not Listed"}
                        {e.startAt && e.endAt && `–${formatTime(e.endAt)}`}
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
                    <ScheduleDateBadge iso={e.startAt} date={e.date} live={false} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-semibold text-primary">{e.title}</p>
                      <p className="mt-0.5 truncate text-metadata text-muted">
                        {e.startAt ? formatTime(e.startAt) : "Time Not Listed"}
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
                  Findmi is reviewing your requested area. Once approved, your business is added to that
                  area&rsquo;s browsing.
                </p>
              </>
            ) : (
              <>
                <p className="mt-1.5 text-body font-semibold text-muted">No Findmi area selected yet</p>
                <p className="mt-2 text-metadata text-subtle">
                  A Findmi area is optional. It places your business in that area&rsquo;s browsing. Where you&rsquo;ll be
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
              href={managerHref(id, "inbox")}
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
                        <input autoCapitalize="sentences"
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
            recommended={recommendedOpportunities}
            explore={exploreData}
            filters={exploreFilters}
            nav={growthSummary ? <GrowthNav basePath={basePath} active="opportunities" badges={growthBadges(growthSummary)} summary={growthSummary} /> : null}
          />
        )}

        {/* ── /account V2 — More (secondary destinations) ───────────── */}
        {activeTab === "more" && (
          <MoreMenu businessId={id} businessSlug={business.slug} ordersRelevant={ordersRelevant} />
        )}

        {/* Referral now renders inside Settings (?tab=settings) —
            ?tab=referral redirects there whenever referralPartner exists
            (see the redirect logic above); activeTab can never equal
            "referral" by the time rendering reaches here. */}
    </>
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
  readiness?: MarketplaceReadiness;
}): { label: string; tone: "quiet" | "positive" | "attention" | "negative" } {
  if (!p.is_active) return { label: "Inactive", tone: "quiet" };
  if (p.moderationStatus === "rejected") return { label: "Not approved", tone: "negative" };
  if (p.moderationStatus === "pending_review") return { label: "Pending review", tone: "attention" };
  if (p.hasPendingChanges) return { label: "Changes pending", tone: "attention" };
  if (p.marketplaceStatus === "submitted") return { label: "Marketplace pending", tone: "attention" };
  if (p.readiness?.eligible) return { label: "In Marketplace", tone: "positive" };
  if (p.marketplaceStatus === "approved") return { label: "Approved · Checkout not ready", tone: "attention" };
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
function ScheduleDateBadge({ iso, date, live }: { iso: string | null; date?: string | null; live?: boolean }) {
  if (live) {
    return (
      <span className="flex w-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg bg-findmi py-1.5 text-white">
        <LiveDotSmall />
        <span className="text-label font-bold uppercase">Now</span>
      </span>
    );
  }
  // A date with no published time shows its real calendar date.
  const month = iso ? new Date(iso).toLocaleDateString("en-US", { month: "short" }) : date ? calendarMonthAbbrev(date) : "";
  const day = iso ? String(new Date(iso).getDate()) : date ? calendarDayOfMonth(date) : "";
  return (
    <span className="flex w-11 shrink-0 flex-col items-center justify-center rounded-lg bg-black/[0.04] py-1.5">
      <span className="text-label font-bold uppercase text-subtle">{month}</span>
      <span className="font-display text-body font-bold leading-none text-primary">{day}</span>
    </span>
  );
}

/** Schedule rows chronologically without fake times. */
function compareScheduleRows(a: { key: string; startAt: string | null; date: string }, b: { key: string; startAt: string | null; date: string }): number {
  return compareChronological({ start_at: a.startAt, end_at: null, occurrence_date: a.date, id: a.key }, { start_at: b.startAt, end_at: null, occurrence_date: b.date, id: b.key });
}
