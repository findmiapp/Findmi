import type { Metadata } from "next";
import NavIcon from "@/components/NavIcon";
import SupabaseImage from "@/components/SupabaseImage";
import { notFound } from "next/navigation";
import AdminEditButton from "@/components/AdminEditButton";
import { toJsonLdScript } from "@/lib/jsonLd";
import AppearanceFindMiHere from "@/components/AppearanceFindMiHere";
import BusinessLogoCard from "@/components/BusinessLogoCard";
import BusinessShopSection from "@/components/BusinessShopSection";
import Bulletin from "@/components/Bulletin";
import ImageGalleryStrip from "@/components/ImageGalleryStrip";
import ImageZoomTrigger from "@/components/ImageZoomTrigger";
import BusinessShortDescription from "@/components/BusinessShortDescription";
import PersonCard from "@/components/PersonCard";
import FollowButton from "@/components/FollowButton";
import SaveButton from "@/components/SaveButton";
import ShareButton from "@/components/ShareButton";
import ClaimButton from "@/components/ClaimButton";
import AboutThisPage from "@/components/trust/AboutThisPage";
import { getPageTrust } from "@/lib/provenance";
import EntityActionBar from "@/components/public-actions/EntityActionBar";
import { loadPublicActions } from "@/lib/public-actions";
import FeaturedAppearanceCard from "@/components/FeaturedAppearanceCard";
import PageViewTracker from "@/components/analytics/PageViewTracker";
import AnalyticsLink from "@/components/analytics/AnalyticsLink";
import MessageButton from "@/components/MessageButton";
import { isDirectBusinessMessagingEnabled } from "@/lib/communication-policy";
import { sanitizeBusinessInquiryTopics } from "@/lib/business-inquiry-topics";
import { shouldShowMessageButton } from "@/lib/message-visibility";
import { VerifiedBadge } from "@/components/Badge";
import Link from "next/link";
import MomentsCarousel from "@/components/journal/MomentsCarousel";
import BrandHeading from "@/components/BrandHeading";
import OurLocations from "@/components/OurLocations";
import ContextMap from "@/components/map/ContextMap";
import { brandPlaceResults, scheduleResults } from "@/lib/geo-results-server";
import { publicLocationHref } from "@/lib/location-links";
import SectionAnchorNav from "@/components/SectionAnchorNav";
import { buildSectionAnchors } from "@/lib/section-anchors";
import FindUsAt from "@/components/FindUsAt";
import { FIND_US_AT_PUBLIC_LIMIT, getAvailabilityLocationsForBusiness } from "@/lib/business-location-availability";
import { getLocationsForBusiness } from "@/lib/business-locations";

/** Our Locations shown on the public page — bounded, so a large chain never
 * becomes an endless list. */
const OUR_LOCATIONS_LIMIT = 24;
import { addMomentHref, getPublicJournalCollection, journalCollectionHref, momentsEmptyStateText } from "@/lib/journal-distribution";
import type { Business, BusinessWithCategories } from "@/lib/types";
import {
  attachCategories,
  getAlternativeBusinesses,
  getBusinessBySlug,
  getBusinessGalleryImages,
  getPeopleForBusiness,
  getBusinessFindmiHereActivity,
  getProductsForBusiness,
  PUBLIC_BUSINESS_COLUMNS,
  type AppearanceWithEventSlug,
} from "@/lib/data";
import { cityState, cityStateZip, formatAppearanceDateRange, formatTime, getTemporalLabel } from "@/lib/format";
import { getPublicHandleForEntity } from "@/lib/handles";
import { validateCustomDestination } from "@/lib/navigation";
import { getPublicOrigin } from "@/lib/site-url";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getServerSupabase } from "@/lib/supabase/server";
import { getSupabase } from "@/lib/supabase";
import { isBusinessPro } from "@/lib/entitlements";
import { resolveAppearanceDisplayImage } from "@/lib/appearance-image";
import { collapseEventDates } from "@/lib/findmi-here";
import { resolveBusinessHero } from "@/lib/business-hero";
import { HIDDEN_LOCATION_COPY } from "@/lib/event-attendance";
import { eventHref } from "@/lib/event-links";

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
 * id. Free Tier Entitlement Reset V1 — called unconditionally for every
 * business now (contact info is core presence, not Pro-only); this
 * function still only reads, it never decides who's allowed to see the
 * result — display is entirely up to the caller. */
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

  const location = cityStateZip(business.city, business.state, business.postal_code);
  // Free Tier Entitlement Reset V1 bug fix — description/short_description
  // are real, public, both-tier fields on the page itself (see
  // BusinessPublicView below); this metadata function had fallen out of
  // sync with that (it still substituted a category/generic fallback for
  // Free), so a Free business's real description never appeared in a
  // search snippet or share preview even though it was already visible
  // on the page. Now matches the on-page rule exactly, for both tiers.
  const description =
    business.description?.trim().slice(0, 160) ||
    business.short_description?.trim().slice(0, 160) ||
    [business.categories[0]?.name, location].filter(Boolean).join(" · ") ||
    `Discover ${business.name} on Findmi.`;
  const ogImage = business.cover_image_url ?? business.logo_url ?? undefined;
  const url = await resolveCanonicalUrl(business.id, business.slug);

  return {
    // absolute: the name already carries the brand suffix, so the root
    // "%s · Findmi" template would otherwise repeat it.
    title: { absolute: `${business.name} | Findmi` },
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

  // Free Tier Entitlement Reset V1 — `pro` still resolved (still used
  // below for the couple of things that remain genuinely Pro-only on
  // this page: the Inquire CTA's own separate business-controlled
  // setting, and the "+N" extra-category count — neither touched by
  // this pass), but it no longer gates contact info, products,
  // appearances, gallery, people, or CTAs/Bulletin.
  const pro = await resolveIsPro(business.id);
  // Free Tier Entitlement Reset V1 — contact info (phone/email) is core
  // truthful business presence, not a paid upsell; fetched for every
  // business now, same as products/people/gallery below.
  const contact = await resolveBusinessContact(business.id);

  // "Discover More Like This" surfaces OTHER businesses, not additional
  // content about this one, so it's unaffected by plan tier — fetched
  // either way.
  const alternatives = await getAlternativeBusinesses(business);

  // Free Tier Entitlement Reset V1 — products/people/gallery/appearances
  // are all fetched in full for every business now. Products/Locations/
  // Appearances are core "create and distribute" presence; the previous
  // Free/Pro split here is removed. getUpcomingAppearancesForBusiness is
  // now called the same way for every business (no `limit` argument —
  // its own default of 20, with the existing "Show N More" disclosure
  // below handling anything beyond the first 3 shown at once). This is
  // still a PUBLIC DISPLAY concern only — it never touched owner-side
  // Appearance creation/management (Command Center's own aggregation
  // queries this same table with no such limit), storage, event rosters,
  // or /find, and still doesn't.
  const [products, activity, people, galleryImages, journal, ourLocations, findUsAt, wherePlaces] = await Promise.all([
    getProductsForBusiness(business.id),
    // Upcoming activity reconciled with the Business's approved Event
    // participation and each Event's CURRENT schedule (read-only — see
    // getBusinessFindmiHereActivity): an Event-level Appearance follows
    // its Event's dates, so a rescheduled Event can't vanish behind a stale
    // Appearance date, and approved participation without an Appearance
    // still counts.
    getBusinessFindmiHereActivity(business.id),
    getPeopleForBusiness(business.id),
    getBusinessGalleryImages(business.id),
    // Journal Distribution V1 — public, published experiences connected to
    // this Business; small preview set + exact count for "See all".
    getPublicJournalCollection({ subjectType: "business", subjectId: business.id, limit: 6, withCount: true }),
    // Our Locations — public (anon) read: published, non-archived Locations
    // explicitly connected to this Business. Fails safe to none.
    getLocationsForBusiness(getSupabase(), business.id, { publicOnly: true, limit: OUR_LOCATIONS_LIMIT }),
    // Find Us At — public (anon) read of third-party places carrying this
    // Business (explicit links only; never one it operates). Only the small
    // displayed set is requested.
    getAvailabilityLocationsForBusiness(getSupabase(), business.id, { publicOnly: true, limit: FIND_US_AT_PUBLIC_LIMIT }),
    // Map Everywhere — the same real relationships, as places on a map.
    brandPlaceResults(business),
  ]);
  const wherePlaceCount = new Set(wherePlaces.map((r) => r.place.id)).size;
  // EVENT IDENTITY != SCHEDULE OCCURRENCES. The Featured Appearance card
  // shows a multi-date Event ONCE (its live date, else its next date — see
  // lib/findmi-here); Findmi Here below is the schedule and keeps every
  // individual date (scheduleAppearances).
  const appearances = collapseEventDates(activity.upcoming);
  // A featured override pointing at another date of a collapsed Event
  // resolves to that Event's card.
  const featuredOverrideId = (() => {
    const id = business.featured_appearance_id ?? null;
    if (!id || appearances.some((a) => a.id === id)) return id;
    const eventId = activity.upcoming.find((a) => a.id === id)?.event_id;
    return eventId ? (appearances.find((a) => a.event_id === eventId)?.id ?? null) : null;
  })();

  // Featured Appearance System — replaces the old split presentation
  // (immersive Featured Event card for an event-backed appearance vs. a
  // plain white "Next Up" card for a standalone one) with ONE unified
  // card for whichever single Appearance resolves. Pure/synchronous, no
  // extra query: reuses the exact `appearances` array already fetched
  // above for Findmi Here. Null when this Business has nothing upcoming
  // at all (see resolveBusinessHero in lib/business-hero.ts for the
  // manual-override/stale-selection rules).
  // Hero precedence (lib/business-hero.ts): the Business's own pick →
  // a Findmi editorially Featured Event it's an approved participant in →
  // Happening Now → nearest upcoming.
  const featuredAppearance = resolveBusinessHero(appearances, { overrideId: featuredOverrideId, featuredEvents: activity.featuredEvents })?.item ?? null;
  const featuredTemporal = featuredAppearance
    ? getTemporalLabel(featuredAppearance.start_at, featuredAppearance.end_at)
    : null;
  const featuredIsEvent = Boolean(featuredAppearance?.event?.slug);
  // Findmi Here schedule: every upcoming date/appearance, always. Featured
  // is promotion only — the date it shows (live or not) stays in its place
  // in the canonical chronological schedule.
  const scheduleAppearances = activity.upcoming;
  // Map Everywhere — the same schedule, each date at its own Location.
  const scheduleGeo = await scheduleResults(scheduleAppearances, business);
  // Image Fallback Refinement pass — precedence is now: the most specific
  // real image already attached to this appearance (its own flyer image,
  // else its linked Event's own cover image when event-backed — never
  // swapped out, so illy's real "A Cup of Love" photo is untouched), else
  // a deterministic pick from this Business's own gallery (spreads
  // image-less appearances across real photos instead of repeating the
  // cover on every one), else the Business's own cover image, else
  // FeaturedAppearanceCard's own safe neutral fallback. No new query:
  // `galleryImages` is the same getBusinessGalleryImages result already
  // fetched above for the Gallery section.
  const featuredImageUrl = featuredAppearance
    ? resolveAppearanceDisplayImage({
        appearanceId: featuredAppearance.id,
        specificImageUrl: featuredAppearance.flyer_image_url ?? featuredAppearance.event?.cover_image_url ?? null,
        galleryImages,
        businessCoverUrl: business.cover_image_url,
      })
    : null;
  // Real destination only — event > location > in-page anchor, the exact
  // same precedence AppearanceCard's own click target already uses. Never
  // a new /appearance/[id] route.
  const featuredHref = featuredAppearance
    ? featuredIsEvent
      ? eventHref(featuredAppearance.event!.slug, featuredAppearance.event_occurrence_id)
      : !featuredAppearance.location_hidden && publicLocationHref(featuredAppearance.location)
        ? publicLocationHref(featuredAppearance.location)!
        : "#findmi-here"
    : null;
  // Same directions-URL construction AppearanceCard's own lowest-tier
  // fallback uses (venue_name/address/city/state) — Directions is a
  // distinct physical-navigation intent from View Details, and null
  // whenever there isn't enough real location data for a maps query.
  const featuredMapsQuery = featuredAppearance && !featuredAppearance.location_hidden
    ? [featuredAppearance.venue_name, featuredAppearance.address, cityState(featuredAppearance.city, featuredAppearance.state)]
        .filter(Boolean)
        .join(", ")
    : "";
  const featuredDirectionsHref = featuredMapsQuery
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(featuredMapsQuery)}`
    : null;
  // formatAppearanceDateRange already respects the established "Time TBD"
  // semantics (isTimeUnknown) — never a fabricated exact time.
  const featuredDateTimeLine = featuredAppearance
    ? featuredTemporal?.live
      ? featuredAppearance.end_at
        ? `Until ${formatTime(featuredAppearance.end_at)}`
        : "Happening now"
      : formatAppearanceDateRange(featuredAppearance.start_at, featuredAppearance.end_at, featuredAppearance.description)
    : null;
  // "Venue Name · City, ST" — the same combined-join pattern already
  // established for occurrence mini-cards (BusinessLogoCard), never just
  // one half when both are legitimately available.
  // Location privacy (lib/event-location-privacy): no venue for an Event
  // that shares its address only after registration.
  const featuredVenueName = featuredAppearance?.location_hidden
    ? HIDDEN_LOCATION_COPY
    : (featuredAppearance?.location?.name ?? featuredAppearance?.venue_name ?? null);
  const featuredLocationLabel = featuredAppearance ? cityState(featuredAppearance.city, featuredAppearance.state) : "";
  const featuredVenueLine = featuredAppearance
    ? [featuredVenueName, featuredLocationLabel].filter(Boolean).join(" · ") || null
    : null;

  // "Meet the Owners" only when every configured role genuinely says so —
  // never assumed. Any broader/mixed set of roles gets the honest generic
  // heading instead.
  const allOwnersOrFounders =
    people.length > 0 && people.every((p) => /owner|founder/i.test(p.role ?? ""));
  const sectionAnchors = buildSectionAnchors([
    { id: "findmi-here", label: "Findmi Here", present: scheduleAppearances.length > 0 },
    { id: "our-locations", label: "Our Locations", present: ourLocations.items.length > 0 },
    { id: "find-us-at", label: "Find Us Here", present: findUsAt.items.length > 0 },
    { id: "shop", label: "Shop", present: products.length > 0 },
    { id: "gallery", label: "Gallery", present: galleryImages.length > 1 },
    { id: "moments", label: "Moments", present: journal.entries.length > 0 },
    { id: "about", label: "About", present: Boolean(business.description) },
    { id: "people", label: "People", present: people.length > 0 },
  ]);
  const peopleHeading = allOwnersOrFounders ? "Meet the Owners" : `Meet the People Behind ${business.name}`;

  // Unify Site-Wide Communications pass — Inquire no longer resolves to
  // any external URL/Form Manager form/mailto (all of which either
  // exposed the business's private email or left the thread outside
  // Findmi entirely). It's now always the native InquireButton, opened
  // from a General Inquiry Public Action, which creates a real Conversation
  // (subject_type='business_inquiry') — see components/InquireButton.tsx
  // and lib/opportunities.ts's createInquiryConversation. inquiry_cta_url
  // and inquiry_cta_label stay in the schema, unread (deprecated): the
  // button's words now come from its Public Action.
  //
  // Business-Controlled Inquiry Settings pass — Pro alone no longer
  // shows INQUIRE (that was the actual bug this pass fixes — see its own
  // migration note). The owner must have explicitly turned on Accept
  // Inquiries (accepts_inquiries) AND selected at least one inquiry
  // topic; neither is inferred from Pro status, existing contact info,
  // or any legacy CTA field. No business was bulk-enabled.
  const enabledInquiryTopics = sanitizeBusinessInquiryTopics(business.inquiry_topics);
  const canInquire = pro && business.accepts_inquiries && enabledInquiryTopics.length > 0;
  // Public Actions — the ONE source of the action bar under identity: only
  // the actions this Business's managers configured and enabled. Accept
  // Inquiries / topics are capability only (they decide whether a General
  // Inquiry action can work), never visibility.
  // Trust & Privacy Phase 2A — About This Page + honest message routing.
  const pageTrust = await getPageTrust(getAdminSupabase(), "business", business.id);
  const noRecipient = pageTrust ? pageTrust.state !== "managed" : false;
  const publicActions = await loadPublicActions(getAdminSupabase(), "business", business.id, {
    generalInquiry: canInquire,
    website: isSafeExternalUrl(business.website_url) ? business.website_url : null,
  });
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

  // Free Tier Entitlement Reset V1 — all four standard social links
  // (Website/Instagram/Facebook/TikTok) are core presence now, public for
  // both tiers; the previous Free/Pro split on Facebook/TikTok is
  // removed. Phone/email are likewise fetched and shown for both tiers
  // now (see `contact` above).
  const detailsSocialLinks = socialLinks;
  // Compact Location + Links pass — location is no longer part of this
  // check at all: it already renders compactly inline with category in
  // the identity block above (line ~490, now Free+Pro), which was
  // ALWAYS the real, correct, compact placement — the old DetailsBlock
  // duplicated it a second time inside a large card below. This is now
  // purely "is there any contact/social action to show."
  const hasContactActions = Boolean(contact.phone || contact.email || detailsSocialLinks.length > 0);

  // Computed ahead of render so the Announcement's wrapping spacing `<div>`
  // only renders alongside real content. (The legacy CTA 1/2/3 link row was
  // retired by Public Actions — those columns are no longer read.)
  const hasBulletin = Boolean(business.bulletin_enabled && business.bulletin_body?.trim());

  const canonicalUrl = await resolveCanonicalUrl(business.id, business.slug);

  // Truthful LocalBusiness JSON-LD — every field is a real, already-public
  // column; nothing here is inferred or fabricated (no ratings, priceRange,
  // geo coordinates, or hours — none of those are modeled in the schema).
  // address only includes locality/region since businesses has no street-
  // address field to draw from. Free Tier Entitlement Reset V1 — every
  // field here (description/social links/location/phone) is now public
  // for both tiers, kept in sync with the on-page rendering above.
  const sameAs = [business.website_url, business.instagram_url, business.facebook_url, business.tiktok_url].filter(
    isSafeExternalUrl
  );
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
    // Free/Pro Entitlement Realignment pass — location is public
    // structured data for both tiers now, matching the on-page identity
    // block above.
    ...(business.city || business.state || business.postal_code
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
              <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Preview Mode: Pending Review</p>
              <p className="mt-0.5 text-sm text-ink/70">This page is only visible to you until Findmi approves it.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Link
                href={`/account/business/${business.id}`}
                className="rounded-xl bg-findmi px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
              >
                Edit Business
              </Link>
              <Link
                href="/account"
                className="rounded-xl border border-findmi/30 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-findmi-700 transition hover:border-findmi/50"
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
          {/* Field QA UX Pass 2 — the real cover opens the shared lightbox
              (cover first, then this Business's own gallery). The
              placeholder never does. */}
          {business.cover_image_url && (
            <ImageZoomTrigger
              images={[business.cover_image_url, ...galleryImages.filter((u) => u !== business.cover_image_url)]}
              alt={business.name}
              label={`View larger image of ${business.name}`}
            />
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
                <SupabaseImage src={business.logo_url} alt={business.name} fill sizes="112px" className="object-contain" />
                <ImageZoomTrigger images={[business.logo_url]} alt={business.name} label={`View larger logo for ${business.name}`} />
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
                <MessageButton targetType="business" targetId={business.id} targetName={business.name} messagingEnabled={isDirectBusinessMessagingEnabled()} />
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
                placeholder when none apply.
                Remove Consumer-Facing Plan Status pass — Founding Member
                no longer renders here: it's a paid plan/membership status,
                not a consumer discovery attribute. business.founding_member
                is untouched as a real field (still used by account/admin/
                billing/entitlement resolution); only this public badge is
                removed. Verified and Featured are unrelated to plan status
                and are preserved exactly as before. */}
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{business.name}</h1>
            {/* Business Hero Metadata Consistency pass — Featured is
                editorial curation (businesses.is_featured), not a trust
                badge; it no longer renders here as a separate pill (it
                used to visually compete with name/category/geography).
                The underlying is_featured field, Admin controls, and
                every other consumer of it (homepage/discovery sorting,
                etc.) are untouched — this removes ONE presentation, not
                the data. Verified is unrelated and still shows. */}
            {business.verified && (
              <div className="flex flex-wrap items-center gap-1.5">
                <VerifiedBadge />
              </div>
            )}
            {/* Business Hero Metadata Consistency pass — category is now a
                compact aqua pill (same accent language as the rest of the
                app) rather than plain bold text, so it reads as a distinct
                chip instead of competing with the business name above it.
                Area stays quiet text on the same row. Both halves are
                independently optional — no empty pill, no dangling
                separator — and this still carries only the real,
                dynamic category/location data already resolved above.
                Business Info Block pass — category/location + the short
                description now sit together in ONE lightweight bordered
                block (white, hairline border, no shadow); the description
                clamps to 2 lines with an inline Read More. */}
            {(primaryCategory || location || business.short_description) && (
              <div className="rounded-xl border border-black/[0.08] bg-white px-3 py-2.5">
                {(primaryCategory || location) && (
                  <p className="flex flex-wrap items-center gap-1.5 text-sm text-ink/55">
                    {primaryCategory && (
                      <span className="inline-flex items-center rounded-full bg-findmi-50 px-2.5 py-1 text-xs font-bold text-findmi-700">
                        {primaryCategory.name}
                      </span>
                    )}
                    {/* Free shows exactly 1 category — the "+N" extra-category
                        count is Pro-only, regardless of how many category rows
                        the business actually has (a Free business is limited to
                        one going forward, but a legacy row could still carry
                        more from before that rule existed). */}
                    {pro && primaryCategory && extraCategoryCount > 0 && <span className="text-ink/40">+{extraCategoryCount}</span>}
                    {/* Free/Pro Entitlement Realignment pass — city/state/ZIP
                        are Free-public now (FREE = GET FOUND: a consumer
                        discovery platform needs a business's location
                        regardless of plan tier), so `location` renders for both
                        tiers here. The "+N" extra-category count above stays
                        Pro-only — unrelated field, unchanged by this pass. */}
                    {primaryCategory && location && <span aria-hidden="true">·</span>}
                    {location && (
                      <span>
                        {location}
                        {business.service_radius_miles ? ` · serves within ${business.service_radius_miles} mi` : ""}
                      </span>
                    )}
                  </p>
                )}
                {/* Free profile correction — short description is identity-level
                    copy (like name/category), not promotional profile content,
                    so it now shows for both tiers; everything else in this
                    identity block stays pro-gated as before. */}
                {business.short_description && (
                  <div className={primaryCategory || location ? "mt-1.5" : ""}>
                    <BusinessShortDescription text={business.short_description} />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Public Actions — directly under identity (category, place, short
          bio) and above Featured Appearance: what a visitor can do here. */}
      {(publicActions.actions.length > 0 || publicActions.opportunityCount > 0) && (
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mt-4 max-w-xl">
            <EntityActionBar
              kind="business"
              entityId={business.id}
              entityName={business.name}
              pagePath={`/business/${business.slug}`}
              actions={publicActions.actions}
              inquiryTopics={enabledInquiryTopics}
              opportunityCount={publicActions.opportunityCount}
              noRecipient={noRecipient}
            />
          </div>
        </div>
      )}

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
          the list immediately below it. Renders nothing for a business
          with no upcoming appearances (see the right rail's own Inquire-
          becomes-primary behavior for that state instead).
          Featured Appearance System — this used to split into an immersive
          FeaturedEventCard for an event-backed appearance vs. a plain
          white "Next Up" card for a standalone one (two unrelated visual
          structures depending on provenance a visitor never sees).
          FeaturedAppearanceCard is now the ONE unified presentation for
          whichever single Appearance resolveBusinessHero above
          resolves, event-backed or standalone alike.
          Featured Appearance Heading pass — "Featured Appearance" used to
          render as overlay text inside the card itself. It now sits
          outside/above the card as a real section label.
          Small Public UI Polish pass — that eyebrow-only treatment
          (text-xs/uppercase/text-findmi-700) still read noticeably weaker
          than this profile's other major section headings (FindMi Here's
          own "Upcoming Schedule" h2, Gallery's h2), both of which use
          the font-display/text-lg/font-bold/tracking-tight/text-ink
          convention. Converged onto that same convention so Featured
          Appearance carries the same visual authority as its peers,
          instead of merely being bolded. */}
      {featuredAppearance && (
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mt-5 max-w-xl">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink">Featured Appearance</h2>
            <div className="mt-2">
              <FeaturedAppearanceCard
                title={featuredAppearance.title}
                imageUrl={featuredImageUrl}
                viewDetailsHref={featuredHref ?? "#findmi-here"}
                directionsHref={featuredDirectionsHref}
                dateTimeLine={featuredDateTimeLine}
                venueLine={featuredVenueLine}
              />
            </div>
          </div>
        </div>
      )}

      {/* Contextual navigation — chips only for the sections that actually
          render below (lib/section-anchors.ts); omitted on a short profile. */}
      <SectionAnchorNav items={sectionAnchors} />

      <div className="mx-auto max-w-6xl px-4 pb-12 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-10">
        {/* Right rail on desktop: primary action + Follow/Save, and (desktop
            only) the details/contact block — written first in the DOM so
            it naturally lands right after identity on mobile too. */}
        <div className="lg:order-2 lg:sticky lg:top-20">
          {/* Inquire moved up into the Public Actions bar under identity. */}

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
              className="hidden lg:block"
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
          {scheduleAppearances.length > 0 && (
            // mt-6 keeps a clear break from whatever renders above it (on
            // mobile, Inquire itself, above this column — see the rail
            // div's own note); desktop is unaffected (lg:mt-0, separated
            // by the column layout instead). This is now the first
            // section in this column, so it carries the "first item"
            // spacing CTA row/Bulletin used to.
            <section id="findmi-here" className="mt-6 scroll-mt-24 lg:mt-0">
              <AppearanceFindMiHere
                appearances={scheduleAppearances}
                business={{
                  id: business.id,
                  name: business.name,
                  slug: business.slug,
                  logo_url: business.logo_url,
                  cover_image_url: business.cover_image_url,
                  shareUrl: canonicalUrl,
                }}
                galleryImages={galleryImages}
                analyticsContext={{ pageType: "business" }}
                geo={scheduleGeo}
              />
            </section>
          )}

          {/* Our Locations — permanent places this Business operates
              (explicit business_locations links only; never Event or
              Appearance venues). Physical presence sits beside Findmi
              Here (temporary presence); nothing renders with none. */}
          <OurLocations businessName={business.name} locations={ourLocations.items} first={scheduleAppearances.length === 0} />

          {/* Find Us At — third-party places that carry/serve this Business,
              directly after Our Locations (places it operates) so the
              physical-presence story reads: Findmi Here → Our Locations →
              Find Us At. Nothing renders with none. */}
          <FindUsAt businessName={business.name} locations={findUsAt.items} />

          {/* Where To Find Us — Map Everywhere: every real place this Brand
              operates, is Available Here or pops up (no headquarters point
              without one of those relationships). Lazily started. */}
          {wherePlaces.length > 0 && (
            <section id="where-to-find-us" className="mt-8 scroll-mt-24" aria-labelledby="where-to-find-us-heading">
              <h2 id="where-to-find-us-heading" className="font-display text-lg font-bold tracking-tight text-ink">
                Where To Find Us
              </h2>
              {wherePlaceCount > 1 && <p className="mt-1 text-sm text-ink/55">Tap a marker on the map to see location details.</p>}
              <div className="mt-3">
                <ContextMap results={wherePlaces} label={`Map of where to find ${business.name}`} tall={wherePlaceCount > 1} initialSelect="single" />
              </div>
            </section>
          )}

          {/* The optional Announcement (Bulletin) — profile content, not an
              action; the visitor actions live in the Public Actions bar. */}
          {hasBulletin && (
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
              purchasable alone. Free Tier Entitlement Reset V1 — `products`
              is now fetched for every business (see above), so this
              section shows real products for Free and Pro alike; only
              existing moderation/marketplace-eligibility rules (untouched,
              enforced inside getProductsForBusiness) still decide what a
              "real" product is. */}
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
              else it's used. Free Tier Entitlement Reset V1 — `galleryImages`
              is now fetched for every business (see above), so this shows
              a real gallery for Free and Pro alike; existing upload/
              validation rules (unchanged) still decide what's in it. */}
          {galleryImages.length > 1 && (
            <section id="gallery" className="mt-8 scroll-mt-24">
              <h2 className="font-display text-lg font-bold tracking-tight text-ink">Gallery</h2>
              <div className="mt-4">
                <ImageGalleryStrip images={galleryImages} alt={business.name} />
              </div>
            </section>
          )}

          {/* Moment V1A — the section no longer disappears when this
              Business has zero public Moments: "+ Add Moment" (the exact
              existing contextual-prefill route, /my-world/journal/new?
              business=<id> — see addMomentHref) needs to stay discoverable
              either way. The heading's own trailing pill is the ONE "+ Add
              Moment" action on the page; MomentsCarousel's new emptyState
              prop renders a restrained one-line fallback instead of a
              second CTA when there are no Moments yet. The PERSON who
              creates it is always the author — this link never makes the
              Business the author of anything. */}
          <section id="moments" className="mt-8 scroll-mt-24">
            {/* Same "Findmi Moments" BrandHeading + context line as the
                Event/Location pages; the name wraps in the left column and
                never runs under + Add Moment. */}
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
              <div className="min-w-[11rem] flex-1">
                <BrandHeading accent="Moments" />
                <p className="mt-0.5 break-words font-display text-base font-bold leading-snug tracking-tight text-ink">with {business.name}</p>
              </div>
              <Link
                href={addMomentHref("business", business.id)}
                className="inline-flex gap-1.5 h-8 shrink-0 items-center rounded-full border border-findmi/40 bg-white px-3.5 text-metadata font-bold text-findmi-700 transition hover:border-findmi/60 hover:bg-findmi-50"
              >
                <span aria-hidden="true" className="inline-flex"><NavIcon name="moments" className="h-4 w-4 shrink-0" /></span>
                Add Moment
              </Link>
            </div>
            <div className="mt-4">
              <MomentsCarousel
                entries={journal.entries}
                total={journal.total}
                viewAllHref={journalCollectionHref("business", business.slug)}
                emptyState={<p className="text-metadata text-muted">{momentsEmptyStateText("business", business.name)}</p>}
              />
            </div>
          </section>

          {/* About/description — Free/Pro Entitlement pass: unlocked for
              Free (basic-profile field, see CLAUDE.md's "FREE = PRESENCE +
              SCHEDULE" principle). Unlike products/gallery/appearances/
              people this comes straight off the already-fetched `business`
              row rather than a conditionally-run query, so no plan check
              is needed here at all now — it renders whenever set. */}
          {business.description && (
            <section id="about" className="mt-8 scroll-mt-24">
              <h2 className="font-display text-lg font-bold tracking-tight text-ink">About {business.name}</h2>
              <p className="mt-3 max-w-2xl whitespace-pre-line text-sm leading-relaxed text-ink/70">{business.description}</p>
            </section>
          )}

          {/* People — editorial, human; single person gets a stronger
              treatment, multiple people use a horizontal carousel. Never
              rendered empty. Free Tier Entitlement Reset V1 — `people` is
              now fetched for every business (see above); this was plan-
              gated display only, no other privacy/approval rule involved
              (getPeopleForBusiness itself is unchanged), so removing the
              plan gate here is display-entitlement-only, exactly as
              intended. */}
          {people.length > 0 && (
            <section id="people" className="mt-8 scroll-mt-24">
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
          <AboutThisPage entityType="business" entityId={business.id} entityName={business.name} trust={pageTrust} className="mt-8" />

          <div className="mt-4">
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

/** The shared Brand / Business icon (NavIcon "storefront"). */
function StorefrontGlyph({ className }: { className?: string }) {
  return <NavIcon name="storefront" className={className} />;
}
