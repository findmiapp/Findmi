import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { errorRedirectUrl, isoToLocalDateTime } from "@/lib/admin/form-helpers";
import { requireBusinessMember } from "@/lib/permissions";
import { isBusinessPro } from "@/lib/entitlements";
import { getCategories, getProductCategories } from "@/lib/data";
import ProInviteCodeEntry from "@/components/ProInviteCodeEntry";
import TabNav, { type TabNavItem } from "@/components/TabNav";
import AccountNav from "../../AccountNav";
import {
  addAppearanceFromEvent,
  addManualAppearance,
  createMemberProduct,
  removeOwnerAppearance,
  requestReferralPartnerPayout,
  returnProductToCatalog,
  setMemberProductActive,
  submitProductToMarketplace,
  updateBusinessGallery,
  updateBusinessLinks,
  updateBusinessProfile,
  updateMemberProduct,
  updateOwnerAppearance,
} from "../actions";
import MemberImageField from "./MemberImageField";
import MemberGalleryField from "./MemberGalleryField";
import MemberProductActiveButton from "./MemberProductActiveButton";
import AppearanceFieldsForm, { type AppearanceFieldValues } from "./AppearanceFieldsForm";
import ProductFieldsForm, { type ProductFieldValues } from "./ProductFieldsForm";
import { formatDateShort, formatDateShortInZone, formatTime, formatTimeInZone } from "@/lib/format";
import { getPublicOrigin } from "@/lib/site-url";
import CopyButton from "@/components/CopyButton";
import { getReferralPartnerByBusinessId } from "@/lib/admin/referral-queries";
import type { EventParticipationStatus } from "@/lib/types";

const PARTICIPATION_LABEL: Record<EventParticipationStatus, string> = {
  invited: "Invited",
  applied: "Pending",
  pending: "Pending",
  approved: "Approved",
  declined: "Declined",
};

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
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";
const primaryButtonClass =
  "flex h-12 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600";
const cardClass = "rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6";

// Tabbed Business Manager pass — Manage Business used to be one long
// scrolling page (Business Basics -> Gallery/About/Contact/Announcement
// behind a single Pro gate -> FindMi Here -> Products). Reducing that
// scroll without rebuilding any working CRUD means: keep every existing
// field/component/action exactly as it was, just group them into
// sections switched via ?tab=<key> (a real Link-based nav, see TabNav —
// no client state/SPA framework) and split the one giant save into
// per-tab saves (updateBusinessProfile/updateBusinessLinks/
// updateBusinessGallery in ../actions.ts) so saving one section can
// never resubmit or overwrite another. Products and FindMi Here keep
// their own existing, independent actions untouched — they already
// saved section-by-section (per-appearance, per-product) before this
// pass, so they just move into their own tabs unchanged.
const OWNER_TABS: TabNavItem[] = [
  { key: "overview", label: "Overview" },
  { key: "profile", label: "Profile" },
  { key: "gallery", label: "Gallery" },
  { key: "products", label: "Products" },
  { key: "findmi-here", label: "FindMi Here" },
  { key: "links", label: "Links & Contact" },
  { key: "plan", label: "Plan & Status" },
  // Referral Partner + Discount Foundation — only ever shown/valid when
  // this business actually has a referral_partners row (an admin set
  // them up as a partner); see OWNER_TAB_KEYS/visibleTabs below, which
  // filter this key out entirely otherwise.
  { key: "referral", label: "Referral" },
];
const OWNER_TAB_KEYS = new Set(OWNER_TABS.map((t) => t.key));

/** MY FINDMI — MANAGE BUSINESS PAGE. The owner-facing editor for a
 * claimed business, calling the existing split Server Actions directly
 * (no update logic duplicated here) — this page only reads what it
 * needs to render each tab's form and hands each submit off entirely to
 * its own action, which already owns every authorization/validation/
 * allowlist/atomicity concern for that section.
 *
 * Free Business Editing Pass 3 — Free still gets its own basic-factual
 * field set (name/logo/cover/short description/city/state/category, in
 * the Profile tab), and Pro additionally gets a Profile-only addition
 * (full description, country) plus the entirely Pro-only Gallery and
 * Links & Contact tabs — mirrors updateBusinessProfile/
 * updateBusinessLinks/updateBusinessGallery's own allowlists exactly
 * (../actions.ts), so nothing shown here can submit a field those
 * actions wouldn't already accept. */
export default async function ManageBusinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    tab?: string;
    saved?: string;
    error?: string;
    created?: string;
    pro_payment?: string;
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
  }>;
}) {
  const { id } = await params;
  const {
    tab: tabParam,
    saved,
    error,
    created,
    pro_payment: proPayment,
    editing,
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
  } = await searchParams;
  const tab = tabParam && OWNER_TAB_KEYS.has(tabParam) ? tabParam : "overview";

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Same defense-in-depth re-check every other /account Server
  // Component/Action already does.
  if (!user) redirect(`/login?next=${encodeURIComponent(`/account/business/${id}`)}`);

  // Real, session-scoped authorization — never trusts anything from the
  // URL beyond the id itself. Same requireBusinessMember() foundation
  // every split action uses; a visitor with no business_members row for
  // this business never sees the form at all, existing account error
  // pattern (an ?error= banner on the account home, same shape every
  // other /account page already uses).
  try {
    await requireBusinessMember(id);
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

  const [{ data: business }, categories, { data: businessCategoryRows }, { data: galleryRows }] = await Promise.all([
    admin
      .from("businesses")
      .select(
        "id, name, slug, logo_url, cover_image_url, plan_tier, publication_status, short_description, description, city, state, country, email, phone, website_url, instagram_url, facebook_url, tiktok_url, bulletin_enabled, bulletin_label, bulletin_heading, bulletin_body, bulletin_url"
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
  ]);
  if (!business) redirect(errorRedirectUrl("/account", "Business not found."));

  const pro = isBusinessPro(business);
  const currentCategoryId = businessCategoryRows?.[0]?.category_id ?? "";
  const galleryImages = (galleryRows ?? []).map((r) => r.url);
  const profileAction = updateBusinessProfile.bind(null, id);
  const linksAction = updateBusinessLinks.bind(null, id);
  const galleryAction = updateBusinessGallery.bind(null, id);

  // Referral Partner + Discount Foundation — this business's OWN
  // referral-partner record, if an admin has ever set one up for it
  // (unrelated to whether THIS business was itself referred — see
  // referral_attributions, never read here). null for the overwhelming
  // majority of businesses, in which case the whole Referral tab is
  // simply omitted below — never an empty/broken tab.
  const referralPartner = await getReferralPartnerByBusinessId(id);
  const visibleTabs = referralPartner ? OWNER_TABS : OWNER_TABS.filter((t) => t.key !== "referral");
  const activeTab = tab === "referral" && !referralPartner ? "overview" : tab;
  const requestPayoutAction = referralPartner
    ? requestReferralPartnerPayout.bind(null, id, referralPartner.id)
    : null;

  // Legacy categories stay in the DB for existing relationships but are no
  // longer offered as a new choice — except for a business already
  // assigned to one, so editing this page can never silently drop it.
  const selectableCategories = categories.filter(
    (c) => !LEGACY_BUSINESS_CATEGORY_SLUGS.has(c.slug) || c.id === currentCategoryId
  );

  // FindMi Here — Owner Appearance Manager. Free Appearance Manager
  // Final Functional Fix — this data fetch, and the manager UI it feeds
  // below, are no longer Pro-gated: appearance MANAGEMENT (add/connect/
  // edit/remove/withdraw) is a Free capability (Passes 1-2 already
  // authorized it at the Server Action layer; this page's UI just
  // hadn't caught up). The Free/Pro distinction is DISPLAY DEPTH on the
  // public business profile (business/[slug]/page.tsx, untouched by
  // this pass — Free shows only its next 1, Pro shows the full
  // schedule), never management access here. Two separate reads: (1)
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
    participationStatus: EventParticipationStatus | null;
  };
  let appearances: OwnAppearance[] = [];
  let requestOptions: { value: string; label: string }[] = [];

  {
    const nowIso = new Date().toISOString();
    const [{ data: appearanceRows }, { data: ebStatusRows }, { data: eobStatusRows }] = await Promise.all([
      admin
        .from("appearances")
        .select(
          "id, title, start_at, end_at, venue_name, address, city, state, external_url, flyer_image_url, event_id, event_occurrence_id"
        )
        .eq("business_id", id)
        .neq("status", "canceled")
        .gt("end_at", nowIso)
        .order("start_at", { ascending: true }),
      admin.from("event_businesses").select("event_id, status").eq("business_id", id),
      admin.from("event_occurrence_businesses").select("occurrence_id, status").eq("business_id", id),
    ]);

    const statusByEvent = new Map((ebStatusRows ?? []).map((r) => [r.event_id, r.status as EventParticipationStatus]));
    const statusByOccurrence = new Map(
      (eobStatusRows ?? []).map((r) => [r.occurrence_id, r.status as EventParticipationStatus])
    );

    appearances = (appearanceRows ?? []).map((a) => ({
      ...a,
      participationStatus: a.event_occurrence_id
        ? (statusByOccurrence.get(a.event_occurrence_id) ?? null)
        : a.event_id
          ? (statusByEvent.get(a.event_id) ?? null)
          : null,
    }));

    const linkedEventIds = new Set(appearances.filter((a) => !a.event_occurrence_id).map((a) => a.event_id));
    const linkedOccurrenceIds = new Set(appearances.map((a) => a.event_occurrence_id).filter((x): x is string => Boolean(x)));

    // Picker: upcoming, non-demo events not already on this business's
    // own appearance calendar. An event with occurrences is only ever
    // offered per-date (never as a bare event-level option) — a
    // recurring event is always added at the occurrence level.
    const [{ data: events }, { data: occurrences }] = await Promise.all([
      admin.from("events").select("id, name, is_demo, start_at, end_at").eq("is_demo", false),
      admin.from("event_occurrences").select("id, event_id, start_at, timezone").gt("start_at", nowIso).order("start_at"),
    ]);

    const occurrencesByEvent = new Map<string, { id: string; start_at: string; timezone: string }[]>();
    for (const occ of occurrences ?? []) {
      const list = occurrencesByEvent.get(occ.event_id) ?? [];
      list.push(occ);
      occurrencesByEvent.set(occ.event_id, list);
    }

    for (const ev of events ?? []) {
      const evOccurrences = occurrencesByEvent.get(ev.id) ?? [];
      if (evOccurrences.length > 0) {
        for (const occ of evOccurrences) {
          if (linkedOccurrenceIds.has(occ.id)) continue;
          requestOptions.push({
            value: `occ:${ev.id}:${occ.id}`,
            label: `${ev.name} — ${formatDateShortInZone(occ.start_at, occ.timezone)} · ${formatTimeInZone(occ.start_at, occ.timezone)}`,
          });
        }
      } else {
        const upcoming = ev.end_at ? new Date(ev.end_at) > new Date() : ev.start_at ? new Date(ev.start_at) > new Date() : false;
        if (!upcoming || linkedEventIds.has(ev.id)) continue;
        requestOptions.push({ value: `event:${ev.id}`, label: ev.name });
      }
    }
  }

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
  // too, purely for display: a "Pending Review" / "Live" / "Changes
  // Pending Review" / "Rejected" / "Inactive" badge (displayState below)
  // and, for a live product with a standing proposal, defaulting the Edit
  // form to the PROPOSED values rather than the live ones (so the owner
  // is editing their draft, not silently reverting it). Nothing here
  // grants any write capability — createMemberProduct/updateMemberProduct
  // (../actions.ts) are the only place moderation_status ever changes,
  // fully server-side, regardless of what this page renders.
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
    displayState: "Pending Review" | "Live" | "Changes Pending Review" | "Rejected" | "Inactive";
    editDefaults: ProductFieldValues;
    // Product Marketplace Distribution pass — SEPARATE from
    // moderationStatus/displayState above, never merged with it: this is
    // whether the product may appear in broader FindMi Marketplace/
    // discovery surfaces, not whether its content is approved.
    marketplaceStatus: "catalog_only" | "submitted" | "approved" | "rejected" | "paused";
    marketplaceState: "Catalog Only" | "Marketplace Review Pending" | "Marketplace Approved" | "Marketplace Not Approved" | "Marketplace Paused";
  };
  let products: OwnProduct[] = [];
  let productCategories: Awaited<ReturnType<typeof getProductCategories>> = [];
  if (pro) {
    const [{ data: productRows }, fetchedProductCategories] = await Promise.all([
      admin
        .from("products")
        .select(
          "id, name, slug, description, image_url, price, price_label, product_type, external_purchase_url, is_active, moderation_status, pending_changes, marketplace_status"
        )
        .eq("business_id", id)
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

      const displayState: OwnProduct["displayState"] =
        moderationStatus === "pending_review"
          ? "Pending Review"
          : moderationStatus === "rejected"
            ? "Rejected"
            : !p.is_active
              ? "Inactive"
              : hasPendingChanges
                ? "Changes Pending Review"
                : "Live";

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
      const marketplaceState: OwnProduct["marketplaceState"] =
        marketplaceStatus === "submitted"
          ? "Marketplace Review Pending"
          : marketplaceStatus === "approved"
            ? "Marketplace Approved"
            : marketplaceStatus === "rejected"
              ? "Marketplace Not Approved"
              : marketplaceStatus === "paused"
                ? "Marketplace Paused"
                : "Catalog Only";

      return {
        ...p,
        product_type: p.product_type as "product" | "service",
        categoryId,
        moderationStatus,
        hasPendingChanges,
        displayState,
        editDefaults,
        marketplaceStatus,
        marketplaceState,
      };
    });
  }
  const addProduct = createMemberProduct.bind(null, id);

  const addFromEvent = addAppearanceFromEvent.bind(null, id);
  const addManual = addManualAppearance.bind(null, id);

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
  };

  const basePath = `/account/business/${id}`;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <AccountNav />

      <div className="mx-auto max-w-md">
        <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Manage Business</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">{business.name}</h1>
        <span
          className={`mt-2 inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
            pro ? "bg-findmi text-white" : "bg-black/[0.06] text-ink/60"
          }`}
        >
          {pro ? "Pro" : "Free"} Plan
        </span>
      </div>

      <div className="mx-auto mt-5 max-w-md">
        <TabNav items={visibleTabs} activeKey={activeTab} basePath={basePath} />
      </div>

      <div className="mx-auto mt-5 max-w-md">
        {error && (
          <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        )}
        {saved && !error && (
          <p className="mb-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
            Saved.
          </p>
        )}

        {/* ── Overview ─────────────────────────────────────────────── */}
        {activeTab === "overview" && (
          <div className="flex flex-col gap-4">
            {created && (
              <p className="rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
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
                <p className="rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
                  Payment received — FindMi Pro is active. Full Pro tools are unlocked below.
                </p>
              ) : (
                <p className="rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
                  Payment received. We&rsquo;re activating Pro — this usually only takes a moment. Refresh this page
                  shortly if it doesn&rsquo;t update automatically.
                </p>
              ))}
            {proPayment === "cancelled" && (
              <p className="rounded-xl border border-black/10 bg-black/[0.02] px-4 py-3 text-sm text-ink/60">
                Checkout was canceled — your business is still Free. You can upgrade to Pro anytime.
              </p>
            )}

            {business.publication_status === "pending_review" && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-bold text-amber-800">Pending Review</p>
                <p className="mt-1 text-sm text-amber-900/80">
                  Your business is saved and you can continue building your profile. It will appear in FindMi
                  discovery after review.
                </p>
                {/* Onboarding UX Polish pass — explicit action into the
                    existing authenticated owner-preview fallback
                    (resolveOwnerPreviewBusiness, business/[slug]/page.tsx) —
                    same page, just a clearer entry point than only finding it
                    from /account's own business list. */}
                {business.slug && (
                  <Link
                    href={`/business/${business.slug}`}
                    className="mt-3 inline-flex text-xs font-semibold text-amber-800 underline underline-offset-2 hover:text-amber-900"
                  >
                    Preview Your Page →
                  </Link>
                )}
              </div>
            )}

            <div className={cardClass}>
              <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Quick Links</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {visibleTabs.filter((t) => t.key !== "overview").map((t) => (
                  <Link
                    key={t.key}
                    href={`${basePath}?tab=${t.key}`}
                    className="rounded-xl border border-black/10 px-3.5 py-3 text-sm font-semibold text-ink transition hover:border-black/20"
                  >
                    {t.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Profile ──────────────────────────────────────────────── */}
        {activeTab === "profile" && (
          <div className={cardClass}>
            <form action={profileAction} className="flex flex-col gap-4">
              <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Business Basics</p>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-ink">Business name</span>
                <input type="text" name="name" required defaultValue={business.name} className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-ink">Category</span>
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
                <span className="mb-1.5 block text-sm font-medium text-ink">Short description</span>
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
              <p className="mt-2 text-xs font-bold uppercase tracking-wide text-ink/40">Location</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-ink">City</span>
                  <input type="text" name="city" defaultValue={business.city ?? ""} className={inputClass} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-ink">State</span>
                  <input type="text" name="state" defaultValue={business.state ?? ""} className={inputClass} />
                </label>
              </div>

              {/* Pro-only additions — PROFILE_PRO_COLUMNS in
                  ../actions.ts allows these only when this business's
                  server-resolved plan_tier is Pro. Free never renders
                  this block, so a Free owner can't even see these
                  inputs, let alone submit them — and even if they
                  crafted a raw request with these field names, the
                  action's own allowlist (resolved server-side, never
                  from the submitted form) silently drops them. */}
              {pro && (
                <>
                  <p className="mt-2 text-xs font-bold uppercase tracking-wide text-ink/40">About</p>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-ink">About / full description</span>
                    <textarea
                      name="description"
                      rows={5}
                      defaultValue={business.description ?? ""}
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-ink">Country</span>
                    <input type="text" name="country" defaultValue={business.country ?? ""} className={inputClass} />
                  </label>
                </>
              )}

              <button type="submit" className={`mt-1 ${primaryButtonClass}`}>
                Save Profile
              </button>
            </form>
          </div>
        )}

        {/* ── Gallery ──────────────────────────────────────────────── */}
        {activeTab === "gallery" &&
          (pro ? (
            <div className={cardClass}>
              <form action={galleryAction} className="flex flex-col gap-4">
                <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Gallery</p>
                <MemberGalleryField businessId={id} name="gallery_image_url" initialUrls={galleryImages} />
                <button type="submit" className={`mt-1 ${primaryButtonClass}`}>
                  Save Gallery
                </button>
              </form>
            </div>
          ) : (
            <UpgradeLockedTab businessId={id} description="Show off your business with additional photos." />
          ))}

        {/* ── Products ─────────────────────────────────────────────── */}
        {activeTab === "products" &&
          (pro ? (
            <div className={cardClass}>
              <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Products</p>
              <p className="mt-1 text-sm text-ink/60">Show customers what you make, sell or offer.</p>

              {products.length > 0 ? (
                <ul className="mt-4 flex flex-col gap-3">
                  {products.map((p) => (
                    <li key={p.id} className="rounded-2xl border border-black/10 p-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          {p.image_url && (
                            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-black/10 bg-black/5">
                              {/* eslint-disable-next-line @next/next/no-img-element -- small preview only, a live Storage URL */}
                              <img src={p.image_url} alt="" className="h-full w-full object-cover" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-ink">{p.name}</p>
                            {/* Product Moderation pass — moderation state badge.
                                Same priority order as displayState above:
                                a product that's never been approved (or was
                                rejected) says so regardless of is_active;
                                only an approved/live product's own
                                deactivation shows as "Inactive". */}
                            <p
                              className={`mt-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                                p.displayState === "Live"
                                  ? "text-findmi-700"
                                  : p.displayState === "Rejected"
                                    ? "text-red-600"
                                    : "text-amber-700"
                              }`}
                            >
                              {p.displayState}
                            </p>
                            {/* Product Marketplace Distribution pass — a
                                SECOND, separate badge from displayState
                                above: distribution state, never merged with
                                content moderation state. */}
                            <p
                              className={`mt-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                                p.marketplaceState === "Marketplace Approved"
                                  ? "text-sky-700"
                                  : p.marketplaceState === "Marketplace Not Approved"
                                    ? "text-red-600"
                                    : "text-ink/40"
                              }`}
                            >
                              {p.marketplaceState}
                            </p>
                            {(p.price != null || p.price_label) && (
                              <p className="mt-0.5 text-xs text-ink/60">{p.price_label || `$${p.price}`}</p>
                            )}
                          </div>
                        </div>
                        <MemberProductActiveButton
                          action={setMemberProductActive.bind(null, id, p.id, !p.is_active)}
                          isActive={p.is_active}
                        />
                      </div>

                      {p.moderationStatus === "pending_review" && (
                        <p className="mt-2 text-xs text-ink/50">
                          This product will appear publicly after FindMi approves it.
                        </p>
                      )}
                      {p.hasPendingChanges && (
                        <p className="mt-2 text-xs text-ink/50">
                          Your submitted changes are waiting on FindMi&rsquo;s approval — the version above stays
                          publicly visible until then.
                        </p>
                      )}
                      {p.moderationStatus === "rejected" && (
                        <p className="mt-2 text-xs text-ink/50">
                          FindMi didn&rsquo;t approve this product. Edit and resubmit it for another review.
                        </p>
                      )}

                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-semibold text-findmi-700">Edit</summary>
                        <div className="mt-3 flex flex-col gap-3">
                          {/* Product Management Completion pass — Marketplace
                              Distribution now shown INSIDE Edit for every
                              Product (new or existing, owner- or admin-
                              created — there is no separate rendering path),
                              not just at creation time. Owner-facing
                              transitions only, separate from content
                              moderation above: never offers "approved"/
                              "paused" as something the owner can set
                              directly — those only ever come from
                              admin/products/actions.ts. */}
                          <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
                            <p className="text-xs font-semibold text-ink">Where This Product Appears</p>
                            <p className="mt-1 text-xs text-ink/60">
                              {p.marketplaceStatus === "catalog_only" &&
                                "Catalog Only — shown on your FindMi business profile and storefront only."}
                              {p.marketplaceStatus === "submitted" && "Marketplace Review Pending — awaiting FindMi's decision."}
                              {p.marketplaceStatus === "approved" &&
                                "Marketplace Approved — may also appear across FindMi Marketplace and discovery."}
                              {p.marketplaceStatus === "rejected" &&
                                "Marketplace Not Approved — still shown on your business profile and storefront."}
                              {p.marketplaceStatus === "paused" &&
                                "Marketplace Paused — temporarily out of Marketplace/discovery; still shown on your business profile."}
                            </p>
                            {(p.marketplaceStatus === "catalog_only" || p.marketplaceStatus === "rejected") && (
                              <form action={submitProductToMarketplace.bind(null, id, p.id)} className="mt-2">
                                <button type="submit" className="text-xs font-semibold text-sky-700 hover:underline">
                                  {p.marketplaceStatus === "rejected" ? "Resubmit To Marketplace" : "Submit To Marketplace"}
                                </button>
                              </form>
                            )}
                            {p.marketplaceStatus === "submitted" && (
                              <form action={returnProductToCatalog.bind(null, id, p.id)} className="mt-2">
                                <button type="submit" className="text-xs font-semibold text-ink/60 hover:underline">
                                  Cancel Submission
                                </button>
                              </form>
                            )}
                            {p.marketplaceStatus === "rejected" && (
                              <form action={returnProductToCatalog.bind(null, id, p.id)} className="mt-1">
                                <button type="submit" className="text-xs font-semibold text-ink/50 hover:underline">
                                  Return To Catalog Only
                                </button>
                              </form>
                            )}
                            {(p.marketplaceStatus === "approved" || p.marketplaceStatus === "paused") && (
                              <p className="mt-1 text-xs text-ink/40">
                                Marketplace placement is managed by FindMi and can&rsquo;t be changed here.
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
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-ink/50">No products yet.</p>
              )}

              <div className="mt-5 border-t border-black/10 pt-4">
                <p className="text-sm font-medium text-ink">Add Product</p>
                <div className="mt-2">
                  <ProductFieldsForm
                    businessId={id}
                    action={addProduct}
                    categories={productCategories}
                    defaultValues={{
                      name: "",
                      description: "",
                      image_url: null,
                      price: "",
                      price_label: "",
                      product_type: "product",
                      external_purchase_url: "",
                      category_id: "",
                    }}
                    submitLabel="Add Product"
                    showDistributionChoice
                  />
                </div>
              </div>
            </div>
          ) : (
            <UpgradeLockedTab businessId={id} description="Show customers what you make, sell or offer." />
          ))}

        {/* ── FindMi Here ──────────────────────────────────────────── */}
        {activeTab === "findmi-here" && (
          <div className={cardClass}>
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">FindMi Here</p>
            <p className="mt-1 text-sm text-ink/60">Manage where customers can find you next.</p>

            {appearances.length > 0 ? (
              <ul className="mt-4 flex flex-col gap-3">
                {appearances.map((a) => {
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
                      };
                  return (
                    <li key={a.id} className="rounded-2xl border border-black/10 p-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ink">{a.title}</p>
                          <p className="mt-0.5 text-xs text-ink/60">
                            {formatDateShort(a.start_at)} · {formatTime(a.start_at)}–{formatTime(a.end_at)}
                          </p>
                          {(a.venue_name || a.city) && (
                            <p className="mt-0.5 text-xs text-ink/50">
                              {[a.venue_name, [a.city, a.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
                            </p>
                          )}
                          {a.participationStatus && (
                            <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-findmi-700">
                              Official event participation: {PARTICIPATION_LABEL[a.participationStatus]}
                            </p>
                          )}
                        </div>
                        <form action={removeOwnerAppearance.bind(null, id, a.id)}>
                          <button type="submit" className="shrink-0 text-xs font-semibold text-red-600 hover:underline">
                            Remove
                          </button>
                        </form>
                      </div>

                      <details className="mt-2" open={isEditing}>
                        <summary className="cursor-pointer text-xs font-semibold text-findmi-700">Edit</summary>
                        <div className="mt-3">
                          <AppearanceFieldsForm
                            businessId={id}
                            action={updateOwnerAppearance.bind(null, id, a.id)}
                            defaultValues={editDefaultValues}
                            submitLabel="Save"
                          />
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-ink/50">No upcoming appearances yet.</p>
            )}

            <div className="mt-5 border-t border-black/10 pt-4">
              <p className="text-sm font-medium text-ink">Add an Appearance</p>

              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink/40">
                Option 1 — Choose an existing FindMi event
              </p>
              {requestOptions.length > 0 ? (
                <form action={addFromEvent} className="mt-2 flex flex-wrap items-center gap-2">
                  <select name="target" required className={inputClass} defaultValue="">
                    <option value="" disabled>
                      Choose an event…
                    </option>
                    {requestOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="rounded-full bg-findmi px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
                  >
                    Add
                  </button>
                </form>
              ) : (
                <p className="mt-2 text-sm text-ink/50">No upcoming FindMi events available right now.</p>
              )}

              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink/40">
                Option 2 — Add an appearance manually
              </p>
              <div className="mt-2">
                <AppearanceFieldsForm
                  businessId={id}
                  action={addManual}
                  defaultValues={addDefaultValues}
                  submitLabel="Add Appearance"
                />
              </div>
            </div>
          </div>
        )}

        {/* ── Links & Contact ──────────────────────────────────────── */}
        {activeTab === "links" &&
          (pro ? (
            <div className={cardClass}>
              <form action={linksAction} className="flex flex-col gap-4">
                <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Contact &amp; Links</p>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-ink">Website</span>
                  <input
                    type="url"
                    name="website_url"
                    defaultValue={business.website_url ?? ""}
                    placeholder="https://…"
                    className={inputClass}
                  />
                </label>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-ink">Email</span>
                    <input type="email" name="email" defaultValue={business.email ?? ""} className={inputClass} />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-ink">Phone</span>
                    <input type="tel" name="phone" defaultValue={business.phone ?? ""} className={inputClass} />
                  </label>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-ink">Instagram</span>
                    <input
                      type="url"
                      name="instagram_url"
                      defaultValue={business.instagram_url ?? ""}
                      placeholder="https://instagram.com/…"
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-ink">Facebook</span>
                    <input
                      type="url"
                      name="facebook_url"
                      defaultValue={business.facebook_url ?? ""}
                      placeholder="https://facebook.com/…"
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-ink">TikTok</span>
                    <input
                      type="url"
                      name="tiktok_url"
                      defaultValue={business.tiktok_url ?? ""}
                      placeholder="https://tiktok.com/@…"
                      className={inputClass}
                    />
                  </label>
                </div>

                <p className="mt-2 text-xs font-bold uppercase tracking-wide text-ink/40">Announcement</p>
                <div className="rounded-2xl border border-black/10 p-4">
                  <label className="flex items-center gap-2 text-sm font-medium text-ink">
                    <input type="checkbox" name="bulletin_enabled" defaultChecked={business.bulletin_enabled} />
                    Show announcement
                  </label>
                  <div className="mt-3 flex flex-col gap-3">
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-ink">Announcement label</span>
                      <input
                        type="text"
                        name="bulletin_label"
                        defaultValue={business.bulletin_label ?? ""}
                        placeholder="Announcement"
                        className={inputClass}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-ink">Announcement heading</span>
                      <input
                        type="text"
                        name="bulletin_heading"
                        defaultValue={business.bulletin_heading ?? ""}
                        className={inputClass}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-ink">Announcement message</span>
                      <textarea
                        name="bulletin_body"
                        rows={3}
                        defaultValue={business.bulletin_body ?? ""}
                        className={inputClass}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-ink">Announcement link (optional)</span>
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
            </div>
          ) : (
            <UpgradeLockedTab businessId={id} description="Add your website, socials, contact info, and a live announcement." />
          ))}

        {/* ── Plan & Status ────────────────────────────────────────── */}
        {activeTab === "plan" && (
          <div className={cardClass}>
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Plan &amp; Status</p>
            <span
              className={`mt-2 inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                pro ? "bg-findmi text-white" : "bg-black/[0.06] text-ink/60"
              }`}
            >
              {pro ? "Pro" : "Free"} Plan
            </span>

            {pro ? (
              <p className="mt-3 text-sm text-ink/60">
                FindMi Pro is active — your full business profile, gallery, products, and complete upcoming schedule
                are all unlocked.
              </p>
            ) : (
              <div className="mt-3 rounded-2xl border border-findmi/20 bg-findmi-50 p-4 sm:p-5">
                <p className="text-sm font-bold text-ink">Unlock your full FindMi presence</p>
                {/* Final Conversion Consistency pass — "appearances" removed:
                    Free can already add/manage appearances (Passes 1-2), so
                    naming it here as a Pro upgrade reason was stale. Replaced
                    with the actual Pro-exclusive distinction — the full
                    upcoming schedule showing publicly (Free's public profile
                    shows only its next 1). */}
                <p className="mt-1 text-sm text-ink/60">
                  Upgrade to Pro for your full business details, contact links, gallery, products, and your complete
                  upcoming schedule.
                </p>
                {/* Pro Upgrade — Internal Checkout Handoff Foundation pass: an
                    exact, owned business_id is already known here (this page
                    already required requireBusinessMember(id) above), so this
                    routes through the internal /upgrade/pro handoff instead of
                    straight to the external Tally form. */}
                <Link
                  href={`/upgrade/pro?business=${id}`}
                  className="mt-3 flex h-11 w-full items-center justify-center rounded-full bg-findmi text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
                >
                  Upgrade to Pro
                </Link>

                {/* Pro Invite Sharing UX pass — small, secondary alternative
                    to the Stripe upgrade right above it, for an owner who has
                    a complimentary invite code instead of paying. Reuses the
                    exact same goToRedeemCode -> /redeem/[code] routing/
                    redemption flow as /join and /account (no separate
                    redemption implementation), with this already-authorized
                    business_id passed through as a hint so /redeem/[code]
                    can skip straight to "Apply Pro to {business.name}"
                    instead of showing a business selector. */}
                <details className="group mt-3">
                  <summary className="cursor-pointer text-center text-xs font-semibold text-ink/50 underline underline-offset-2 [&::-webkit-details-marker]:hidden">
                    Have a Pro invite code instead?
                  </summary>
                  <div className="mt-2">
                    <ProInviteCodeEntry returnTo={`/account/business/${id}?tab=plan`} businessId={id} />
                  </div>
                </details>
              </div>
            )}
          </div>
        )}

        {/* ── Referral (partner-facing) ────────────────────────────── */}
        {activeTab === "referral" && referralPartner && (
          <div className={cardClass}>
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Referral Program</p>
            <p className="mt-1 text-sm text-ink/60">
              Share your code — you&rsquo;ll earn a commission when a business you refer upgrades to paid FindMi
              Pro.
            </p>

            {referralPartner.activeCodes.length > 0 ? (
              <div className="mt-4 flex flex-col gap-3">
                {referralPartner.activeCodes.map((code) => {
                  const referralLink = `${getPublicOrigin()}/join?ref=${code}`;
                  return (
                    <div key={code} className="rounded-2xl bg-findmi-50 p-4">
                      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Your Referral Code</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <p className="font-mono text-sm font-semibold text-ink">{code}</p>
                        <CopyButton
                          value={code}
                          label="Copy Code"
                          className="shrink-0 rounded-full bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-white/70"
                        />
                      </div>
                      <p className="mt-2 break-all font-mono text-xs text-ink/70">{referralLink}</p>
                      <CopyButton
                        value={referralLink}
                        label="Copy Link"
                        className="mt-2 shrink-0 rounded-full bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-white/70"
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-4 text-sm text-ink/50">No active referral code yet — check back soon.</p>
            )}

            <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Referred</dt>
                <dd className="mt-1 text-ink">{referralPartner.referralCount}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Free / Paid Pro</dt>
                <dd className="mt-1 text-ink">
                  {referralPartner.freeReferralCount} / {referralPartner.paidReferralCount}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Total Earned</dt>
                <dd className="mt-1 text-ink">${(referralPartner.earnedCommissionCents / 100).toFixed(2)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Total Paid</dt>
                <dd className="mt-1 text-ink">${(referralPartner.paidCommissionCents / 100).toFixed(2)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Available Balance</dt>
                <dd className="mt-1 font-semibold text-findmi-700">
                  ${(referralPartner.availableCommissionCents / 100).toFixed(2)}
                </dd>
              </div>
            </dl>

            {requestPayoutAction && (
              <form action={requestPayoutAction} className="mt-4">
                <button
                  type="submit"
                  disabled={referralPartner.availableCommissionCents <= 0}
                  className="flex h-11 w-full items-center justify-center rounded-full bg-findmi text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Request Payout
                  {referralPartner.availableCommissionCents > 0
                    ? ` of $${(referralPartner.availableCommissionCents / 100).toFixed(2)}`
                    : ""}
                </button>
              </form>
            )}
            <p className="mt-2 text-xs text-ink/40">
              Payouts are reviewed and paid out manually by FindMi — no automatic transfers.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Shared "this tab needs Pro" lock state — same shape Products already
 * used before this pass (upgrade CTA, no broken/empty form), now reused
 * for Gallery and Links & Contact too since all three are entirely
 * Pro-only tabs. */
function UpgradeLockedTab({ businessId, description }: { businessId: string; description: string }) {
  return (
    <div className={cardClass}>
      <p className="mt-1 text-sm text-ink/60">{description}</p>
      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink/40">Available with FindMi Pro</p>
      <Link
        href={`/upgrade/pro?business=${businessId}`}
        className="mt-3 flex h-11 w-full items-center justify-center rounded-full bg-findmi text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
      >
        Upgrade to Pro
      </Link>
    </div>
  );
}
