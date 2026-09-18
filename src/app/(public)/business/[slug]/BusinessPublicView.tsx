import type { Metadata } from "next";
import SupabaseImage from "@/components/SupabaseImage";
import { notFound } from "next/navigation";
import AdminEditButton from "@/components/AdminEditButton";
import { toJsonLdScript } from "@/lib/jsonLd";
import AppearanceCard from "@/components/AppearanceCard";
import BusinessLogoCard from "@/components/BusinessLogoCard";
import BusinessShopSection from "@/components/BusinessShopSection";
import Bulletin from "@/components/Bulletin";
import ImageGalleryStrip from "@/components/ImageGalleryStrip";
import PersonCard from "@/components/PersonCard";
import FollowButton from "@/components/FollowButton";
import SaveButton from "@/components/SaveButton";
import ShareButton from "@/components/ShareButton";
import ClaimButton from "@/components/ClaimButton";
import PageViewTracker from "@/components/analytics/PageViewTracker";
import AnalyticsLink from "@/components/analytics/AnalyticsLink";
import MessageButton from "@/components/MessageButton";
import InquireButton from "@/components/InquireButton";
import { sanitizeBusinessInquiryTopics } from "@/lib/business-inquiry-topics";
import { shouldShowMessageButton } from "@/lib/message-visibility";
import { FeaturedBadge, FoundingMemberBadge, VerifiedBadge } from "@/components/Badge";
import Link from "next/link";
import type { Business, BusinessWithCategories } from "@/lib/types";
import {
  attachCategories,
  getAlternativeBusinesses,
  getBusinessBySlug,
  getBusinessGalleryImages,
  getPeopleForBusiness,
  getProductsForBusiness,
  getUpcomingAppearancesForBusiness,
  PUBLIC_BUSINESS_COLUMNS,
} from "@/lib/data";
import { cityState, cityStateZip, formatAppearanceDateRange, formatTime, getTemporalLabel } from "@/lib/format";
import LiveDot from "@/components/LiveDot";
import { getPublicHandleForEntity } from "@/lib/handles";
import { validateCustomDestination } from "@/lib/navigation";
import { getPublicOrigin } from "@/lib/site-url";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getServerSupabase } from "@/lib/supabase/server";
import { getSupabase } from "@/lib/supabase";
import { isBusinessPro } from "@/lib/entitlements";

/** Vanity URL rendering pass — this is the actual render tree for a
 * Business's public page, shared verbatim by both the canonical
 * /business/[slug] route and the root /[username] vanity route (see
 * that route's own file). Neither route duplicates this logic; each is
 * just a thin wrapper resolving its own params into a `slug` and
 * calling straight into generateBusinessMetadata/BusinessPublicView
 * below — the exact same getBusinessBySlug fetch (Pro gating, owner-
 * preview fallback, JSON-LD) either way. */

function isSafeExternalUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

/** FREE VS PRO GATING — resolved server-side via lib/entitlements.ts,
 * never trusted from the client, never determined by CSS/client hiding.
 * plan_tier isn't in the public column grant (see
 * restrict_internal_commerce_columns / business_plan_tier migrations) —
 * deliberately not widened here, since that would make it readable by
 * any anon REST call — so it's read through a small, separate
 * service-role lookup instead of the public getBusinessBySlug() query.
 * Fails safe: if the admin client isn't available (e.g. this sandbox —
 * see CLAUDE.md §4) or the row can't be read, isBusinessPro({}) resolves
 * to false, so the page renders the more restrictive Free view rather
 * than risking over-exposure when plan state is unknown. Used by both
 * generateMetadata (so a Free business's hidden description/short
 * description never leaks into meta tags either) and the page itself. */
async function resolveIsPro(businessId: string): Promise<boolean> {
  const admin = getAdminSupabase();
  if (!admin) return false;
  const { data } = await admin.from("businesses").select("plan_tier, plan_expires_at").eq("id", businessId).maybeSingle();
  return isBusinessPro(data ?? {});
}

/** TRUSTED CONTACT READ — Contact Data Exposure Remediation pass.
 * businesses.email/phone are no longer in PUBLIC_BUSINESS_COLUMNS or in
 * anon/authenticated's column grant at all (see that constant's own note
 * and the restrict_business_contact_columns migration) — the public
 * getBusinessBySlug() lookup above can no longer return them. This is the
 * one legitimate reader: same service-role pattern as resolveIsPro just
 * above, selecting only the two columns needed, for one specific business
 * id. The caller is responsible for only invoking this AFTER `pro` is
 * already true — never call this for a Free business (no server-side
 * entitlement check happens here; this function only reads, it doesn't
 * decide who's allowed to see the result). */
async function resolveBusinessContact(businessId: string): Promise<{ email: string | null; phone: string | null }> {
  const admin = getAdminSupabase();
  if (!admin) return { email: null, phone: null };
  const { data } = await admin.from("businesses").select("email, phone").eq("id", businessId).maybeSingle();
  return { email: data?.email ?? null, phone: data?.phone ?? null };
}

/** Owner-preview fallback — Native Business Onboarding Pass 2. When the
 * public/live lookup above (getBusinessBySlug) finds nothing, a
 * newly-created or newly-claimed business's own real owner/manager/staff
 * can still open (and share) its direct URL before admin approval,
 * instead of a hard 404. Never weakens the existing public route for
 * anyone else: this only runs as a fallback AFTER the live lookup
 * already returned null, and only ever returns a row when a REAL
 * session exists AND that exact user has a genuine business_members row
 * for it — never guessed, never based on anything client-supplied.
 *
 * Uses the plain session-scoped client, not service-role: the
 * "Public read businesses" RLS policy is already unconditional (row-
 * level access was never what kept a pending business "invisible" — every
 * public query's own explicit .eq("publication_status","live") filter is,
 * a convention this fallback deliberately doesn't apply), and
 * business_members' own RLS ("select own") already scopes the membership
 * check to the caller's real session on its own. So this adds no new
 * database-level exposure — it only adds one new, narrowly-gated
 * APPLICATION path that a real member can reach. is_demo is still
 * excluded either way — demo content is never previewable by anyone. */
async function resolveOwnerPreviewBusiness(slug: string): Promise<BusinessWithCategories | null> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("businesses")
    .select(PUBLIC_BUSINESS_COLUMNS)
    .eq("slug", slug)
    .eq("is_demo", false)
    .maybeSingle();
  if (!data) return null;
  const business = data as unknown as Business;

  const { data: membership } = await supabase
    .from("business_members")
    .select("id")
    .eq("business_id", business.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return null;

  const [withCategories] = await attachCategories([business]);
  return withCategories;
}

async function resolveCanonicalUrl(businessId: string, slug: string): Promise<string> {
  const supabase = getSupabase();
  const handle = supabase ? await getPublicHandleForEntity(supabase, "business", businessId) : null;
  return `${getPublicOrigin()}/${handle ?? `business/${slug}`}`;
}

export async function generateBusinessMetadata(slug: string): Promise<Metadata> {
  let business = await getBusinessBySlug(slug);
  let ownerPreview = false;
  if (!business) {
    business = await resolveOwnerPreviewBusiness(slug);
    if (business) ownerPreview = true;
  }
  if (!business) return { title: "Business not found" };

  const pro = await resolveIsPro(business.id);
  const location = cityStateZip(business.city, business.state, business.postal_code);
  // Free's description/short_description are hidden on the page itself
  // (see BusinessPublicView below) — the meta description falls back to
  // the exact same category+location/generic text a Free page would
  // show, so that hidden copy never leaks into a search snippet or share
  // preview either.
  const description = pro
    ? business.description?.trim().slice(0, 160) ||
      business.short_description?.trim().slice(0, 160) ||
      [business.categories[0]?.name, location].filter(Boolean).join(" · ") ||
      `Discover ${business.name} on Findmi.`
    : business.categories[0]?.name || `Discover ${business.name} on Findmi.`;
  const ogImage = business.cover_image_url ?? business.logo_url ?? undefined;
  const url = await resolveCanonicalUrl(business.id, business.slug);

  return {
    title: `${business.name} | Findmi`,
    description,
    alternates: { canonical: url },
    // Owner-preview pages (not yet approved — see resolveOwnerPreviewBusiness)
    // must never be indexed even though they're technically reachable —
    // this is the only case that sets this; every normal (live) business
    // page is unaffected and stays indexable exactly as before.
    ...(ownerPreview ? { robots: { index: false, follow: false } } : {}),
    openGraph: {
      title: `${business.name} | Findmi`,
      description,
      images: ogImage ? [ogImage] : undefined,
      url,
    },
  };
}

export async function BusinessPublicView({ slug }: { slug: string }) {
  let business = await getBusinessBySlug(slug);
  let ownerPreview = false;
  if (!business) {
    business = await resolveOwnerPreviewBusiness(slug);
    if (business) ownerPreview = true;
  }
  if (!business) notFound();

  const pro = await resolveIsPro(business.id);
  // Only ever read for a Pro business — see resolveBusinessContact's own
  // doc comment. Free never triggers this extra service-role round trip.
  const contact = pro ? await resolveBusinessContact(business.id) : { email: null, phone: null };

  // "Discover More Like This" surfaces OTHER businesses, not additional
  // content about this one, so it's unaffected by plan tier — fetched
  // either way. Everything else below is Pro-only page content, so for a
  // Free business none of these queries even run — not fetched-then-
  // hidden, per the pass's "avoid exposing restricted data unnecessarily"
  // requirement.
  const alternatives = await getAlternativeBusinesses(business);

  let products: Awaited<ReturnType<typeof getProductsForBusiness>> = [];
  let people: Awaited<ReturnType<typeof getPeopleForBusiness>> = [];
  let galleryImages: Awaited<ReturnType<typeof getBusinessGalleryImages>> = [];
  // Free Appearances Pass 2, extended by the Free/Pro Entitlement pass —
  // appearances is fetched for EVERY business, Free included (locked
  // product rule: Free's public profile shows its next THREE eligible
  // upcoming appearances). Still the same query, still data-layer limited
  // via getUpcomingAppearancesForBusiness's own `limit` param (never
  // over-fetched then trimmed) — Free asks for 3, Pro keeps the existing
  // default of 20, same parallel-fetch shape as before for Pro. This is a
  // PUBLIC DISPLAY limit only — it never touches owner-side Appearance
  // creation/management (Command Center's own aggregation queries this
  // same table with no such limit), storage, event rosters, or /find.
  // Every other Pro-only section below (products/people/inquiry form/
  // gallery) is unchanged, still gated `if (pro)`.
  let appearances: Awaited<ReturnType<typeof getUpcomingAppearancesForBusiness>>;
  if (pro) {
    [products, appearances, people, galleryImages] = await Promise.all([
      getProductsForBusiness(business.id),
      getUpcomingAppearancesForBusiness(business.id),
      getPeopleForBusiness(business.id),
      getBusinessGalleryImages(business.id),
    ]);
  } else {
    appearances = await getUpcomingAppearancesForBusiness(business.id, 3);
  }

  // Action Hierarchy pass — Business's strongest CTA should be "find this
  // business" when it has somewhere upcoming to be, not Inquire (a
  // business that moves is the whole point of Findmi; Inquire is contact
  // functionality, a lower-intent action for a visitor who already knows
  // what they want). appearances is already sorted nearest-first by its
  // own query (getUpcomingAppearancesForBusiness), so [0] is genuinely
  // "next up" for both Free (3-item) and Pro (20-item) callers. Same
  // event > location > in-page-anchor destination precedence
  // AppearanceCard itself already uses for its own click target, kept
  // deliberately simple here (no external_url/flyer tiers — this is a
  // page-level CTA, not a full per-card click resolution).
  const nextAppearance = appearances[0] ?? null;
  const nextTemporal = nextAppearance ? getTemporalLabel(nextAppearance.start_at, nextAppearance.end_at) : null;
  const nextVenueLabel = nextAppearance?.location?.name ?? nextAppearance?.venue_name ?? null;
  const nextIsEvent = Boolean(nextAppearance?.event?.slug);
  const nextAppearanceHref = nextAppearance
    ? nextIsEvent
      ? `/event/${nextAppearance.event!.slug}`
      : nextAppearance.location?.slug
        ? `/location/${nextAppearance.location.slug}`
        : "#findmi-here"
    : null;
  // "View Event"/"View Location" only ever labels a real destination
  // (event > location, same precedence as nextAppearanceHref above); an
  // appearance with neither still gets a "View Details" fallback that
  // scrolls to the real Findmi Here list (#findmi-here) rather than
  // implying a page that doesn't exist.
  const nextViewLabel = nextIsEvent ? "View Event" : nextAppearance?.location ? "View Location" : nextAppearance ? "View Details" : null;
  // Same directions-URL construction AppearanceCard's own lowest-tier
  // fallback uses (venue_name/address/city/state), independent of
  // nextAppearanceHref's event/location precedence — Directions is a
  // distinct physical-navigation intent from "view this relationship."
  const nextMapsQuery = nextAppearance
    ? [nextAppearance.venue_name, nextAppearance.address, cityState(nextAppearance.city, nextAppearance.state)]
        .filter(Boolean)
        .join(", ")
    : "";
  const nextDirectionsHref = nextMapsQuery
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(nextMapsQuery)}`
    : null;
  const nextTimeLine = nextAppearance
    ? nextTemporal?.live
      ? nextAppearance.end_at
        ? `Until ${formatTime(nextAppearance.end_at)}`
        : "Happening now"
      : formatAppearanceDateRange(nextAppearance.start_at, nextAppearance.end_at, nextAppearance.description)
    : null;

  // "Meet the Owners" only when every configured role genuinely says so —
  // never assumed. Any broader/mixed set of roles gets the honest generic
  // heading instead.
  const allOwnersOrFounders =
    people.length > 0 && people.every((p) => /owner|founder/i.test(p.role ?? ""));
  const peopleHeading = allOwnersOrFounders ? "Meet the Owners" : `Meet the People Behind ${business.name}`;

  // Unify Site-Wide Communications pass — Inquire no longer resolves to
  // any external URL/Form Manager form/mailto (all of which either
  // exposed the business's private email or left the thread outside
  // Findmi entirely). It's now always the native InquireButton below,
  // which creates a real Conversation (subject_type='business_inquiry')
  // — see components/InquireButton.tsx and
  // lib/opportunities.ts's createInquiryConversation. inquiry_cta_url
  // stays in the schema, simply unread now (inquiry_cta_label is still
  // the button's own founder-editable label).
  //
  // Business-Controlled Inquiry Settings pass — Pro alone no longer
  // shows INQUIRE (that was the actual bug this pass fixes — see its own
  // migration note). The owner must have explicitly turned on Accept
  // Inquiries (accepts_inquiries) AND selected at least one inquiry
  // topic; neither is inferred from Pro status, existing contact info,
  // or any legacy CTA field. No business was bulk-enabled.
  const inquiryLabel = business.inquiry_cta_label?.trim() || "Inquire";
  const enabledInquiryTopics = sanitizeBusinessInquiryTopics(business.inquiry_topics);
  const canInquire = pro && business.accepts_inquiries && enabledInquiryTopics.length > 0;
  const showMessageButton = await shouldShowMessageButton("business", business.id);

  const location = cityStateZip(business.city, business.state, business.postal_code);
  // categories[0] is the same "good enough for a compact label" primary-
  // category convention already used elsewhere (BusinessCard, CompactCard)
  // — not a new taxonomy concept. Anything beyond the first is folded into
  // a plain "+N" count rather than flooding the identity block with pills
  // (Business Profile V2, Part 4).
  const primaryCategory = business.categories[0] ?? null;
  const extraCategoryCount = Math.max(0, business.categories.length - 1);

  // Compact icon row — every link gets its own recognizable glyph (Details
  // polish pass): globe for website, and real Instagram/Facebook/TikTok
  // marks instead of the old generic chain-link icon for the latter two.
  const socialLinks = [
    { href: business.website_url, label: "Website", icon: "globe" as const },
    { href: business.instagram_url, label: "Instagram", icon: "instagram" as const },
    { href: business.facebook_url, label: "Facebook", icon: "facebook" as const },
    { href: business.tiktok_url, label: "TikTok", icon: "tiktok" as const },
  ].filter((l): l is { href: string; label: string; icon: "instagram" | "globe" | "facebook" | "tiktok" } =>
    isSafeExternalUrl(l.href)
  );

  // Free/Pro Entitlement pass — Website and Instagram are basic-profile
  // fields, unlocked for Free (see CLAUDE.md's "FREE = PRESENCE +
  // SCHEDULE" principle); Facebook/TikTok aren't named in that unlock and
  // stay Pro-only, same as before. Phone/email already can't reach this
  // point for Free — `contact` above is hardcoded to {null, null} unless
  // pro. Location stays Pro-only too (unchanged Free-identity rule, see
  // the identity block above) — that's a separate, independent gate from
  // BusinessLinksRow below, which only ever handles contact/social.
  const freeSocialLinks = socialLinks.filter((l) => l.label === "Website" || l.label === "Instagram");
  const detailsSocialLinks = pro ? socialLinks : freeSocialLinks;
  // Compact Location + Links pass — location is no longer part of this
  // check at all: it already renders compactly inline with category in
  // the identity block above (line ~490, `pro && location`), which was
  // ALWAYS the real, correct, compact placement — the old DetailsBlock
  // duplicated it a second time inside a large card below. This is now
  // purely "is there any contact/social action to show."
  const hasContactActions = Boolean(contact.phone || contact.email || detailsSocialLinks.length > 0);

  const canonicalUrl = await resolveCanonicalUrl(business.id, business.slug);

  // Truthful LocalBusiness JSON-LD — every field is a real, already-public
  // column; nothing here is inferred or fabricated (no ratings, priceRange,
  // geo coordinates, or hours — none of those are modeled in the schema).
  // address only includes locality/region since businesses has no street-
  // address field to draw from. Plan-tier gating applies here too, kept in
  // sync with the on-page rendering above rather than only visually
  // hidden: description/website/Instagram are public for both tiers now
  // (Free/Pro Entitlement pass), Facebook/TikTok/phone/location stay
  // Pro-only, and contact.phone is already null for Free regardless.
  const sameAs = [
    business.website_url,
    business.instagram_url,
    ...(pro ? [business.facebook_url, business.tiktok_url] : []),
  ].filter(isSafeExternalUrl);
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: business.name,
    url: canonicalUrl,
    ...(business.cover_image_url || business.logo_url
      ? { image: [business.cover_image_url, business.logo_url].filter((v): v is string => Boolean(v)) }
      : {}),
    ...(business.description || business.short_description
      ? { description: business.description ?? business.short_description }
      : {}),
    ...(contact.phone ? { telephone: contact.phone } : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
    // Free identity has no location — withheld from structured data too,
    // same reasoning as description/phone/sameAs above.
    ...(pro && (business.city || business.state || business.postal_code)
      ? {
          address: {
            "@type": "PostalAddress",
            ...(business.city ? { addressLocality: business.city } : {}),
            ...(business.state ? { addressRegion: business.state } : {}),
            ...(business.postal_code ? { postalCode: business.postal_code } : {}),
          },
        }
      : {}),
  };

  return (
    <div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: toJsonLdScript(jsonLd) }} />
      <PageViewTracker
        subject_type="business"
        subject_id={business.id}
        business_id={business.id}
        page_type="business"
        page_path={`/business/${business.slug}`}
      />

      {/* Owner-preview banner — Native Business Onboarding Pass 2. Only
          renders for the real owner/manager/staff of a not-yet-approved
          business (see resolveOwnerPreviewBusiness); every normal (live)
          visitor never sees this, and it's the only thing distinguishing
          a preview render from the real public page below it. */}
      {ownerPreview && (
        <div className="mx-auto mt-4 max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col gap-2 rounded-2xl border border-findmi/20 bg-findmi-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Preview Mode — Pending Review</p>
              <p className="mt-0.5 text-sm text-ink/70">This page is only visible to you until Findmi approves it.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Link
                href={`/account/business/${business.id}`}
                className="rounded-full bg-findmi px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
              >
                Edit Business
              </Link>
              <Link
                href="/account"
                className="rounded-full border border-findmi/30 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-findmi-700 transition hover:border-findmi/50"
              >
                Back to Dashboard
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Cover / brand hero — a contained, rounded landscape image (not a
          full-bleed banner), matching Product Detail V2's hero treatment
          so the two page types feel like one app. No fabricated imagery:
          a business with no cover just gets the same branded dark
          placeholder used on the product page. */}
      <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6 sm:pt-6">
        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-3xl border border-black/5 bg-mist shadow-sm sm:aspect-[21/9]">
          {business.cover_image_url ? (
            <SupabaseImage
              src={business.cover_image_url}
              alt={business.name}
              fill
              priority
              sizes="(min-width: 1024px) 1024px, 100vw"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-ink">
              <StorefrontGlyph className="h-12 w-12 text-white/15" />
            </div>
          )}
          <AdminEditButton href={`/admin/businesses/${business.id}`} className="absolute right-3 top-3 z-10" />
        </div>
      </div>

      {/* Identity — full width, directly under the cover, so the logo can
          overlap its bottom edge the same way on every breakpoint. Stays
          above the two-column split below rather than living inside the
          sticky right rail, which would otherwise overlap the cover on
          its right edge instead of centered under it. */}
      {/* UI cleanup pass item 2/3: pl-3/sm:pl-4 keeps the overlapping logo
          (and everything under it) off the viewport edge instead of flush
          with the page's own gutter, and max-w-xl keeps the whole
          logo+name+badges+category block reading as one compact identity
          section instead of sprawling across the full desktop width. */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-xl pl-3 sm:pl-4">
          {/* Follow/Save micro-fix (normal-flow only — no absolute
              positioning, no negative translation on Follow/Save itself).
              Only the LOGO carries the negative margin that overlaps the
              cover; items-start on the row means Follow/Save (no margin
              of their own) align to that same unshifted top line, which
              is exactly the cover's bottom edge — they can never render
              above it, full stop, by ordinary box-model construction, not
              by containment math. A small positive top margin (mt-2.5 /
              10px mobile, matching the 96px logo's 40px overlap → 56px
              exposed strip; sm:mt-3.5 / 14px, matching the 112px logo's
              48px overlap → 64px exposed strip) nudges Follow/Save down
              from that top edge to sit centered in the exposed white
              strip beside the logo's lower portion, same reasoning as
              before, just without the absolute-positioning machinery. */}
          <div className="flex items-start gap-2">
            {business.logo_url && (
              <div className="relative -mt-10 h-24 w-24 shrink-0 overflow-hidden rounded-2xl border-4 border-paper bg-white shadow-sm sm:-mt-12 sm:h-28 sm:w-28">
                <SupabaseImage src={business.logo_url} alt={business.name} fill sizes="112px" className="object-cover" />
              </div>
            )}
            <div
              className={`ml-auto flex flex-wrap shrink-0 items-center justify-end gap-1.5 ${business.logo_url ? "mt-2.5 sm:mt-3.5" : ""}`}
            >
              {/* Public Message Action pass — MESSAGE sits directly left
                  of Follow, same row, never a standalone row of its own
                  (locked layout). Both now share the exact same h-9/
                  rounded-lg/text-xs/font-bold/uppercase/tracking-wide
                  geometry — MESSAGE outlined, Follow filled — so they
                  read as a matched pair instead of two unrelated
                  components. No wrapper div around Follow any more (it
                  no longer relies on a fixed w-20 slot — see
                  FollowButton's own shrink-0 sizing). Not Pro-gated:
                  messaging between businesses/organizers is core
                  platform behavior, not a paid profile feature.
                  Unify Site-Wide Communications pass — MESSAGE is a
                  DIRECT MESSAGE affordance (entity-to-entity), so it
                  must not even render for a viewer who isn't signed in
                  and managing an eligible Business/Event — never shown
                  disabled, never shown then redirected to login. See
                  lib/message-visibility.ts's own note; Inquire below is
                  the separate, always-available controlled entry
                  point. */}
              {showMessageButton && (
                <MessageButton targetType="business" targetId={business.id} targetName={business.name} />
              )}
              <FollowButton businessId={business.id} businessSlug={business.slug} businessName={business.name} size="compact" />
              <SaveButton slug={business.slug} id={business.id} />
              {/* Public Graph Integrity Pass 1 — Share as a compact,
                  icon-only utility action alongside Message/Follow/Save,
                  same footprint as Save (h-9/w-9). flex-wrap on this row
                  (added this pass) is the safety net if this four-item
                  row ever gets tight at ~390px — it wraps to a second
                  line rather than overflowing the page horizontally. */}
              <ShareButton
                url={canonicalUrl}
                title={business.name}
                variant="icon"
                track={{ subject_type: "business", subject_id: business.id, business_id: business.id }}
              />
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            {/* Item 2 — badges moved OFF the name's own line (they used to
                sit inline with h1, crowding it as soon as 2-3 stacked up)
                onto their own compact, wrapping row underneath. Recency
                "New" badge removed (public presentation pass) — the
                remaining badges close the space naturally; no empty
                placeholder when none apply. */}
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{business.name}</h1>
            {(business.verified || business.founding_member || business.is_featured) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {business.verified && <VerifiedBadge />}
                {business.founding_member && <FoundingMemberBadge />}
                {business.is_featured && <FeaturedBadge />}
              </div>
            )}
            <p className="flex flex-wrap items-center gap-1.5 text-sm text-ink/55">
              {primaryCategory && <span className="font-semibold text-ink/70">{primaryCategory.name}</span>}
              {/* Free shows exactly 1 category — the "+N" extra-category
                  count is Pro-only, regardless of how many category rows
                  the business actually has (a Free business is limited to
                  one going forward, but a legacy row could still carry
                  more from before that rule existed). */}
              {pro && primaryCategory && extraCategoryCount > 0 && <span className="text-ink/40">+{extraCategoryCount}</span>}
              {/* Free identity is exactly cover/logo/name/1 category —
                  location is hidden too, not just the "+N" count above. */}
              {pro && primaryCategory && location && <span aria-hidden="true">·</span>}
              {pro && location && (
                <span>
                  {location}
                  {business.service_radius_miles ? ` · serves within ${business.service_radius_miles} mi` : ""}
                </span>
              )}
            </p>
            {/* Free profile correction — short description is identity-level
                copy (like name/category), not promotional profile content,
                so it now shows for both tiers; everything else in this
                identity block stays pro-gated as before. */}
            {business.short_description && <p className="text-base text-ink/65">{business.short_description}</p>}
          </div>
        </div>
      </div>

      {/* Live-context relationship module (Public Experience V5) — replaces
          V4's identity-row "Next Up" pill AND the right rail's separate
          "Find [Business] Here" CTA, which together with the Findmi Here
          heading below used to say the same thing up to three times (the
          Cousins Maine Lobster failure case: a HERE NOW pill, then a giant
          FIND COUSINS MAINE LOBSTER FREEHOLD HERE button, then a FINDMI
          HERE / Find Cousins Maine Lobster Freehold Here heading — three
          competing visual systems for one fact). This is now the ONE place
          that answers "where/when are they right now or next," with real
          destinations attached — not a CTA whose only job is scrolling to
          the list immediately below it. Same getTemporalLabel/appearances[0]
          data as before, no new query. Renders nothing for a business with
          no upcoming appearances (see the right rail's own Inquire-becomes-
          primary behavior for that state instead). */}
      {nextAppearance && nextTemporal && (
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div
            className={`mt-5 max-w-xl rounded-2xl border p-4 sm:p-5 ${
              nextTemporal.live ? "border-red-100 bg-red-50/70" : "border-black/[0.06] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
            }`}
          >
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                nextTemporal.live ? "bg-red-600 text-white" : "bg-findmi-50 text-findmi-700"
              }`}
            >
              {nextTemporal.live && <LiveDot className="text-white" />}
              {nextTemporal.live ? "Here Now" : `Next Up · ${nextTemporal.label}`}
            </span>
            <p className="mt-2 font-display text-lg font-bold tracking-tight text-ink">{nextAppearance.title}</p>
            {nextTimeLine && <p className="mt-0.5 text-sm text-ink/60">{nextTimeLine}</p>}
            {nextVenueLabel && <p className="mt-0.5 text-sm text-ink/60">{nextVenueLabel}</p>}
            {(nextViewLabel || nextDirectionsHref) && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {nextViewLabel && nextAppearanceHref && (
                  <Link
                    href={nextAppearanceHref}
                    className="flex h-9 items-center justify-center rounded-lg bg-findmi px-4 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
                  >
                    {nextViewLabel}
                  </Link>
                )}
                {nextDirectionsHref && (
                  <a
                    href={nextDirectionsHref}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-black/10 px-4 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30 hover:text-ink"
                  >
                    Directions
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mx-auto max-w-6xl px-4 pb-12 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-10">
        {/* Right rail on desktop: primary action + Follow/Save, and (desktop
            only) the details/contact block — written first in the DOM so
            it naturally lands right after identity on mobile too. */}
        <div className="mt-6 lg:order-2 lg:sticky lg:top-20 lg:mt-0">
          {/* Action Hierarchy pass (V5) — Follow + Save live in the identity
              block above; the live-context module above the grid already
              gives a business with somewhere upcoming its own "View
              Event/Location" + Directions actions, so this slot no longer
              duplicates that with a second "Find [Business] Here" CTA (the
              V4 version of this row did — see the module's own comment for
              why that was wrong). This slot is Inquire alone, weighted by
              schedule state: a business with an upcoming appearance already
              has a stronger reason above to click through, so Inquire stays
              available but secondary (outline); a business with nothing
              upcoming has no such moment, so Inquire — when the owner
              enabled it — regains the full primary treatment. */}
          {canInquire && (
            <div className="min-w-0">
              <InquireButton
                targetType="business"
                targetId={business.id}
                targetName={business.name}
                label={inquiryLabel}
                topics={enabledInquiryTopics}
                className={
                  appearances.length > 0
                    ? "flex h-11 w-full items-center justify-center rounded-full border border-findmi/40 px-4 text-sm font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-findmi-50"
                    : "flex h-12 w-full items-center justify-center rounded-full bg-findmi px-4 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
                }
              />
            </div>
          )}

          {/* Messaging UX Unification pass — the old "Message on Findmi"
              native-inquiry link (native_inquiries_enabled-gated) used to
              render here as a second, competing "message this business"
              action right below Inquire. It's removed from this public
              page: MESSAGE (in the identity row above) is now the one
              native-Conversation entry point, so this legacy link would
              only confuse visitors about which button actually reaches a
              real Conversation. The native_inquiries_enabled column, its
              admin toggle, and the /account/inquiries/* compose flow it
              gated are all untouched — this is a public-surface removal
              only, not a backend change (see Business Manager's
              Inquiries tab, which still reads/writes this setting). */}

          {/* Compact Location + Links pass — BusinessLinksRow covers only
              phone/email/social/website now (location lives solely in the
              identity block above). Free/Pro Entitlement pass — Website/
              Instagram are now basic-profile fields (see freeSocialLinks
              above), so this isn't gated on `pro` as a whole; phone/email
              still come from plan-aware values already blank for Free
              (contact.{phone,email} are hardcoded null unless pro), so a
              Free business simply never has anything Pro-only to show
              here. */}
          {hasContactActions && (
            <BusinessLinksRow
              business={{ phone: contact.phone, email: contact.email }}
              socialLinks={detailsSocialLinks}
              businessId={business.id}
              className="mt-6 hidden lg:block"
            />
          )}
        </div>

        <div className="lg:order-1">
          {/* FindMi Here — Public Graph Integrity Pass 1: moved ahead of
              the CTA row/Bulletin below. Findmi's differentiator (telling
              consumers where a moving Business can be found next) now
              gets first position in this column, before promotional
              profile content, rather than after it. Hidden entirely (not
              an empty placeholder) when nothing's scheduled, per Business
              Profile V2 Part 9/32. Free Appearances Pass 2 — `appearances`
              is now fetched for every business (see above), just limited
              to 1 for Free vs. 20 for Pro at the data layer (UNCHANGED by
              this pass) — this render block itself needed no change for
              that; with a single item, `.slice(0, 3)` naturally renders
              just that one card and the "Show N More" disclosure below
              never appears (length > 3 is false), so Free's display stays
              to that one card while the richer/full-list behavior stays
              exactly Pro's. */}
          {appearances.length > 0 && (
            // mt-6 keeps a clear break from whatever renders above it (on
            // mobile, Inquire itself, above this column — see the rail
            // div's own note); desktop is unaffected (lg:mt-0, separated
            // by the column layout instead). This is now the first
            // section in this column, so it carries the "first item"
            // spacing CTA row/Bulletin used to.
            <section id="findmi-here" className="mt-6 scroll-mt-24 lg:mt-0">
              {/* Heading no longer restates the business name — the
                  live-context module immediately above already named it
                  ("Next Up · The Native Rose Pop-Up"), so a heading of
                  "Find The Native Rose Here" right underneath read as the
                  same fact a third time (see that module's own note). This
                  is simply the full schedule the module's first entry is
                  drawn from. */}
              <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Findmi Here</p>
              <h2 className="mt-1 font-display text-lg font-bold tracking-tight text-ink">Upcoming</h2>
              <div className="mt-3 flex flex-col gap-2">
                {appearances.slice(0, 3).map((a) => (
                  <AppearanceCard
                    key={a.id}
                    appearance={a}
                    eventSlug={a.event?.slug}
                    analyticsContext={{ pageType: "business" }}
                  />
                ))}
                {appearances.length > 3 && (
                  // Business Profile V2 — same zero-JS <details> disclosure
                  // (native, keyboard-accessible, no client component
                  // needed for a business with 15-20+ Appearances), but
                  // with the standardized stem-less chevron (matching
                  // AppearanceCard/BusinessLogoCard/ProductCard elsewhere)
                  // that actually rotates open/closed instead of vanishing,
                  // and a count so "how many more" is clear before opening.
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-center gap-1.5 rounded-full border border-black/10 py-2.5 text-center text-xs font-bold uppercase tracking-wide text-findmi-700 transition hover:border-findmi/30 [&::-webkit-details-marker]:hidden">
                      <span className="group-open:hidden">Show {appearances.length - 3} More</span>
                      <span className="hidden group-open:inline">Show Less</span>
                      <ChevronGlyph className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-open:rotate-90" />
                    </summary>
                    <div className="mt-2 flex flex-col gap-2">
                      {appearances.slice(3).map((a) => (
                        <AppearanceCard
                          key={a.id}
                          appearance={a}
                          eventSlug={a.event?.slug}
                          analyticsContext={{ pageType: "business" }}
                        />
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </section>
          )}

          {/* Items 2/4 — the up-to-3 custom CTAs and the optional Bulletin,
              now second (after Findmi Here — see above), before Shop/
              About. Both are promotional profile content — Pro-only.
              BusinessCtaRow's own top margin only applies when Findmi
              Here actually rendered above it; otherwise (no upcoming
              appearances) it reverts to being this column's own first
              item, exactly as before this pass. */}
          {pro && (
            <div className={appearances.length > 0 ? "mt-8" : ""}>
              <BusinessCtaRow business={business} />
            </div>
          )}
          {pro && (
            <div className="mt-8">
              <Bulletin
                label={business.bulletin_label?.trim() || "Announcement"}
                heading={business.bulletin_heading}
                body={business.bulletin_enabled ? business.bulletin_body : null}
                url={business.bulletin_url && validateCustomDestination(business.bulletin_url).ok ? business.bulletin_url : null}
              />
            </div>
          )}

          {/* Products — hidden entirely with none, same rule as every other
              optional section on this page. Item 6: now split by real
              purchasable state (BusinessShopSection), and `business` is
              passed through so ProductCard's Add to Cart gate checks the
              real commerce_enabled flag instead of falling back to
              purchasable alone. Free-tier hidden too — implicitly:
              `products` is never fetched for a Free business (see
              above), so it's always [] here regardless of plan. */}
          {products.length > 0 && (
            <BusinessShopSection
              businessName={business.name}
              products={products}
              business={{
                name: business.name,
                slug: business.slug,
                logo_url: business.logo_url,
                commerce_enabled: business.commerce_enabled,
              }}
            />
          )}

          {/* Gallery — Business Profile V2. A real business_images gallery
              (new this pass, same normalized-child-rows pattern as
              event_images), not a repeat of the cover/logo/product photos
              already shown above. ImageGalleryStrip already hides itself
              with fewer than 2 images (nothing to browse), so a business
              with 0-1 gallery photos correctly shows nothing here. Same
              shared lightbox (prev/next, keyboard, close) as everywhere
              else it's used. Free-tier hidden too — implicitly:
              `galleryImages` is never fetched for a Free business (see
              above), so it's always [] here regardless of plan. */}
          {galleryImages.length > 1 && (
            <section className="mt-8">
              <h2 className="font-display text-lg font-bold tracking-tight text-ink">Gallery</h2>
              <div className="mt-4">
                <ImageGalleryStrip images={galleryImages} alt={business.name} />
              </div>
            </section>
          )}

          {/* About/description — Free/Pro Entitlement pass: unlocked for
              Free (basic-profile field, see CLAUDE.md's "FREE = PRESENCE +
              SCHEDULE" principle). Unlike products/gallery/appearances/
              people this comes straight off the already-fetched `business`
              row rather than a conditionally-run query, so no plan check
              is needed here at all now — it renders whenever set. */}
          {business.description && (
            <section className="mt-8">
              <h2 className="font-display text-lg font-bold tracking-tight text-ink">About {business.name}</h2>
              <p className="mt-3 max-w-2xl whitespace-pre-line text-sm leading-relaxed text-ink/70">{business.description}</p>
            </section>
          )}

          {/* People — editorial, human; single person gets a stronger
              treatment, multiple people use a horizontal carousel. Never
              rendered empty. Free-tier hidden too — implicitly: `people`
              is never fetched for a Free business (see above), so it's
              always [] here regardless of plan. */}
          {people.length > 0 && (
            <section className="mt-8">
              <h2 className="font-display text-lg font-bold tracking-tight text-ink">{peopleHeading}</h2>
              {people.length === 1 ? (
                // Narrower on small screens — PersonCard's photo card
                // keeps a fixed aspect ratio, so at the old max-w-xs
                // (320px) this single-card treatment stood nearly full
                // viewport width on mobile (~400px tall) for what's a
                // supplementary bio, not the page's main content. Full
                // max-w-xs comes back at sm: and up, unchanged from before.
                <div className="mt-4 max-w-[220px] sm:max-w-xs">
                  <PersonCard person={people[0]} role={people[0].role} />
                </div>
              ) : (
                <div className="mt-4 -mx-4 flex gap-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {people.map((p) => (
                    <div key={p.id} className="w-40 shrink-0">
                      <PersonCard person={p} role={p.role} />
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {hasContactActions && (
            <BusinessLinksRow
              business={{ phone: contact.phone, email: contact.email }}
              socialLinks={detailsSocialLinks}
              businessId={business.id}
              className="mt-8 lg:hidden"
            />
          )}

          {/* Claim placement pass — moved off the top action area (never
              competing with Inquire/Follow/Save there) into its own
              compact card, immediately before "Discover More Like This".
              Same reused flow/modal/eligibility logic as before (see
              ClaimButton) — only the entry-point states (guest/none) pick
              up this card's copy via variant="card"; a claim already in
              progress still renders its own existing status card. */}
          <div className="mt-8">
            <ClaimButton type="business" slug={business.slug} entityName={business.name} variant="card" />
          </div>

          {/* UI cleanup pass item 6: rebuilt on BusinessLogoCard (the same
              cover+overlapping-logo brand-preview card Brands We Love
              uses) instead of BusinessCard's dark PostCard poster style,
              which read as visually disconnected from the rest of the
              profile. */}
          {alternatives.length > 0 && (
            <section className="mt-8">
              <h2 className="font-display text-lg font-bold tracking-tight text-ink">Discover More Like This</h2>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {alternatives.map((alt) => (
                  <BusinessLogoCard key={alt.id} business={alt} />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/** Business Profile V2 polish pass, item 5 — up to three founder-editable
 * CTA buttons (cta_1/2/3 _label/_url/_enabled on businesses), each
 * independently toggleable. Never renders a slot that's disabled, unlabeled,
 * or missing a safe external URL — and renders nothing at all (no divider
 * either) when none qualify, same "never empty" rule as every other
 * optional section on this page.
 *
 * Business Profile polish pass — restyled from large uppercase pills to
 * compact utility boxes (white, thin border, modest rounded corners,
 * smaller dark-gray text) so up to 3 read as secondary actions, not
 * competing with Inquire. Still natural-width in a wrapping flex row
 * (never centered, never stretched/equal-width) — 1 or 2 sit left-aligned
 * at their own content width, and 3 reasonable labels stay on one row at
 * common mobile widths since each button is now meaningfully narrower;
 * `flex-wrap` only breaks a button to its own line when the actual text
 * genuinely can't fit. */
function BusinessCtaRow({ business }: { business: Business }) {
  const ctas = [
    { label: business.cta_1_label, url: business.cta_1_url, enabled: business.cta_1_enabled },
    { label: business.cta_2_label, url: business.cta_2_url, enabled: business.cta_2_enabled },
    { label: business.cta_3_label, url: business.cta_3_url, enabled: business.cta_3_enabled },
  ].filter(
    (c): c is { label: string; url: string; enabled: true } =>
      c.enabled && Boolean(c.label?.trim()) && isSafeExternalUrl(c.url)
  );

  if (ctas.length === 0) return null;

  // No top divider here anymore (final refinement pass, item 2 moved this
  // row from "below the description, with a divider separating it from
  // About" to the top of the main content column) — a border with nothing
  // above it in that column read as a stray floating line.
  return (
    <section className="mb-8">
      <div className="flex flex-wrap gap-2">
        {ctas.map((cta, i) => (
          <a
            key={i}
            href={cta.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center rounded-lg border border-black/10 bg-white px-3.5 py-2 text-xs font-semibold text-ink/75 transition hover:border-black/20 hover:bg-black/[0.03] hover:text-ink"
          >
            {cta.label}
          </a>
        ))}
      </div>
    </section>
  );
}

/** Compact Location + Links pass — replaces the old DetailsBlock, which
 * wrapped a duplicate location line (already shown compactly inline with
 * category in the identity block above) plus a handful of bare circular
 * icon buttons inside a large bordered/shadowed card. On a Business with
 * only one or two real links, that produced a mostly-empty card reading
 * as unfinished — exactly the live-QA-reported bug. This renders ONLY
 * real, entitled contact/social actions as a compact wrapping row of
 * labeled pills — no card, no "Details" heading, no reserved/empty slots.
 * Rendered twice (mobile's later page position, desktop's sticky rail)
 * via the `className` prop rather than duplicated markup, same
 * responsive technique as before. The caller (`hasContactActions`) skips
 * this entirely when there's nothing real to show — no empty container
 * ever renders, so page flow closes the gap naturally. */
// Analytics attribution pass — maps this row's own icon vocabulary onto
// the canonical click_contact_channel taxonomy (see lib/analytics/
// taxonomy.ts): "mail" -> "email", "globe" -> "website", the rest already
// match 1:1.
const CONTACT_ICON_TO_CHANNEL: Record<ContactIcon, "phone" | "email" | "website" | "instagram" | "facebook" | "tiktok"> = {
  phone: "phone",
  mail: "email",
  globe: "website",
  instagram: "instagram",
  facebook: "facebook",
  tiktok: "tiktok",
};

function BusinessLinksRow({
  business,
  socialLinks,
  businessId,
  className,
}: {
  business: { phone: string | null; email: string | null };
  socialLinks: { href: string; label: string; icon: "instagram" | "globe" | "facebook" | "tiktok" }[];
  businessId: string;
  className: string;
}) {
  // Phone/email join the social links as the same compact pill, in one
  // horizontal wrapping row. Labels stay short ("Call"/"Email") so the
  // row reads evenly regardless of how long the real number/address is —
  // that real value is still there for assistive tech and on hover via
  // aria-label/title, never lost, just not stretching the pill.
  const actions: { href: string; label: string; title: string; icon: ContactIcon; external: boolean }[] = [
    ...(business.phone
      ? [{ href: `tel:${business.phone}`, label: "Call", title: business.phone, icon: "phone" as const, external: false }]
      : []),
    ...(business.email
      ? [{ href: `mailto:${business.email}`, label: "Email", title: business.email, icon: "mail" as const, external: false }]
      : []),
    ...socialLinks.map((l) => ({ href: l.href, label: l.label, title: l.label, icon: l.icon, external: true })),
  ];
  if (actions.length === 0) return null;

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {actions.map((action) => (
        <AnalyticsLink
          key={action.label}
          href={action.href}
          {...(action.external ? { target: "_blank", rel: "noreferrer" } : {})}
          title={action.title}
          aria-label={action.title}
          className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-black/10 px-3 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30 hover:text-ink"
          trackPayload={{
            event_name: "click_contact_channel",
            subject_type: "business",
            subject_id: businessId,
            business_id: businessId,
            metadata: { channel: CONTACT_ICON_TO_CHANNEL[action.icon] },
          }}
        >
          <ContactGlyph icon={action.icon} />
          {action.label}
        </AnalyticsLink>
      ))}
    </div>
  );
}

type ContactIcon = "phone" | "mail" | "instagram" | "globe" | "facebook" | "tiktok";

// Business ↔ Public Parity pass — resized from h-5 to h-3.5 (and the pill
// itself from a rounded-full h-10 to the rounded-lg h-9 Event/Location's
// own Directions/Website/Call pills use, see BusinessLinksRow above) so
// Business's contact/social row reads as the same Findmi contextual-
// action language as the other two public entity pages, not a visibly
// different, older button system. Same icon marks, same click behavior.
function ContactGlyph({ icon }: { icon: ContactIcon }) {
  if (icon === "phone") return <PhoneGlyph className="h-3.5 w-3.5 shrink-0" />;
  if (icon === "mail") return <MailGlyph className="h-3.5 w-3.5 shrink-0" />;
  return <SocialGlyph icon={icon} />;
}

function SocialGlyph({ icon }: { icon: "instagram" | "globe" | "facebook" | "tiktok" }) {
  if (icon === "instagram") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 shrink-0">
        <rect x="3.5" y="3.5" width="17" height="17" rx="5" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="17" cy="7" r="1" fill="currentColor" />
      </svg>
    );
  }
  if (icon === "globe") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 shrink-0">
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
        <ellipse cx="12" cy="12" rx="3.4" ry="8.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3.5 12h17" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    );
  }
  if (icon === "facebook") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 shrink-0">
        <path
          d="M14.5 21v-7.5h2.5l.5-3h-3V8.5c0-.9.3-1.5 1.6-1.5H17.5V4.3C17.2 4.2 16.2 4 15 4c-2.5 0-4 1.5-4 4.3V10.5H8.5v3H11V21"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  // tiktok — a simplified line rendition of the note-and-swirl mark, same
  // minimal stroke language as every other glyph on this page.
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 shrink-0">
      <path
        d="M13 4v10.3a3 3 0 11-2.2-2.9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M13 4c.4 2.3 2.2 4 4.5 4.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PhoneGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M6.5 4h3l1.5 4-2 1.5a11 11 0 005.5 5.5L16 13l4 1.5v3a2 2 0 01-2.2 2A16 16 0 014.5 6.2 2 2 0 016.5 4z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MailGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4.5 7l7.5 6 7.5-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StorefrontGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M4 9.5L5 4h14l1 5.5M4 9.5a2.2 2.2 0 004.3.7M4 9.5a2.2 2.2 0 004.3.7m0 0a2.2 2.2 0 004.4 0m0 0a2.2 2.2 0 004.4 0m0 0a2.2 2.2 0 004.3-.7M5 10v9.5a1 1 0 001 1h5v-6h2v6h5a1 1 0 001-1V10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
