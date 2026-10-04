import type { Metadata } from "next";
import SupabaseImage from "@/components/SupabaseImage";
import { notFound } from "next/navigation";
import AdminEditButton from "@/components/AdminEditButton";
import { toJsonLdScript } from "@/lib/jsonLd";
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
import { FeaturedBadge } from "@/components/Badge";
import Link from "next/link";
import JournalCollection from "@/components/journal/JournalCollection";
import BrandHeading from "@/components/BrandHeading";
import SectionHeading from "@/components/SectionHeading";
import EventCoverLightbox from "@/components/EventCoverLightbox";
import ReadMoreText from "@/components/ReadMoreText";
import { HorizontalScroller } from "@/components/Section";
import BusinessFindmiHere from "@/components/business/BusinessFindmiHere";
import { buildFindmiHere } from "@/lib/findmi-here";
import { getLocationsForBusiness } from "@/lib/business-locations";
import { getPublicJournalCollection, journalCollectionHref } from "@/lib/journal-distribution";
import type { Business, BusinessWithCategories } from "@/lib/types";
import {
  attachCategories,
  getAlternativeBusinesses,
  getBusinessBySlug,
  getBusinessGalleryImages,
  getPeopleForBusiness,
  getProductsForBusiness,
  getPastAppearancesForBusiness,
  getUpcomingAppearancesForBusiness,
  PUBLIC_BUSINESS_COLUMNS,
} from "@/lib/data";
import { cityStateZip } from "@/lib/format";
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
  const [products, appearances, pastAppearances, people, galleryImages, journal, placesPage] = await Promise.all([
    getProductsForBusiness(business.id),
    getUpcomingAppearancesForBusiness(business.id),
    // Public Business V2 — recent history for Findmi Here's Past group
    // (bounded; grouped by experience below, so 24 rows can become a
    // handful of items).
    getPastAppearancesForBusiness(business.id, 24),
    getPeopleForBusiness(business.id),
    getBusinessGalleryImages(business.id),
    // Journal Distribution V1 — public, published experiences connected to
    // this Business; small preview set + exact count for "See all".
    getPublicJournalCollection({ subjectType: "business", subjectId: business.id, limit: 6, withCount: true }),
    // Public Business V2 — the Business's public Locations ("Places" in
    // Findmi Here). Published, non-archived Locations only.
    getLocationsForBusiness(getSupabase(), business.id, { publicOnly: true, limit: 12 }),
  ]);
  const places = placesPage.items;

  // ── Public Business V2 — Findmi Here model ────────────────────────────
  // Presentation-layer grouping (lib/findmi-here): an Event's many dates
  // become ONE experience (event_id is authoritative), standalone
  // appearances stay individual; split into Happening Now (genuinely live
  // only) / Upcoming / Past. featured_appearance_id keeps its meaning — its
  // experience leads Upcoming while it's still eligible — instead of a
  // separate, duplicate "Featured Appearance" block.
  const findmiHere = buildFindmiHere({
    upcoming: appearances,
    past: pastAppearances,
    featuredAppearanceId: business.featured_appearance_id ?? null,
  });
  const hasCurrentActivity = findmiHere.now.length > 0 || findmiHere.upcoming.length > 0 || places.length > 0;

  // Unify Site-Wide Communications pass — Inquire is always the native
  // InquireButton (a real Conversation, subject_type='business_inquiry');
  // inquiry_cta_label is its founder-editable label.
  // Business-Controlled Inquiry Settings pass — shown only when the owner
  // turned on Accept Inquiries AND selected at least one topic (and Pro).
  const inquiryLabel = business.inquiry_cta_label?.trim() || "Inquire";
  const enabledInquiryTopics = sanitizeBusinessInquiryTopics(business.inquiry_topics);
  const canInquire = pro && business.accepts_inquiries && enabledInquiryTopics.length > 0;
  // MESSAGE is a direct entity-to-entity affordance: only for a signed-in
  // viewer managing an eligible Business/Event (lib/message-visibility).
  const showMessageButton = await shouldShowMessageButton("business", business.id);
  // A Business with no real-world activity has no stronger next step, so an
  // enabled Inquire is promoted into the identity actions (same rule as the
  // previous page's primary-vs-outline weighting); otherwise it lives in
  // Contact & Links.
  const promoteInquire = canInquire && !hasCurrentActivity;

  const location = cityStateZip(business.city, business.state, business.postal_code);
  // categories[0] is the compact primary-category convention used elsewhere;
  // the "+N" extra-category count stays Pro-only.
  const primaryCategory = business.categories[0] ?? null;
  const extraCategoryCount = Math.max(0, business.categories.length - 1);

  const socialLinks = [
    { href: business.website_url, label: "Website", icon: "globe" as const },
    { href: business.instagram_url, label: "Instagram", icon: "instagram" as const },
    { href: business.facebook_url, label: "Facebook", icon: "facebook" as const },
    { href: business.tiktok_url, label: "TikTok", icon: "tiktok" as const },
  ].filter((l): l is { href: string; label: string; icon: "instagram" | "globe" | "facebook" | "tiktok" } =>
    isSafeExternalUrl(l.href)
  );
  const hasContactActions = Boolean(contact.phone || contact.email || socialLinks.length > 0);
  const hasCtas = [
    { label: business.cta_1_label, url: business.cta_1_url, enabled: business.cta_1_enabled },
    { label: business.cta_2_label, url: business.cta_2_url, enabled: business.cta_2_enabled },
    { label: business.cta_3_label, url: business.cta_3_url, enabled: business.cta_3_enabled },
  ].some((c) => c.enabled && Boolean(c.label?.trim()) && isSafeExternalUrl(c.url));
  const hasBulletin = Boolean(business.bulletin_enabled && business.bulletin_body?.trim());

  const canonicalUrl = await resolveCanonicalUrl(business.id, business.slug);

  // Truthful LocalBusiness JSON-LD — every field is a real, already-public
  // column; nothing here is inferred or fabricated (no ratings, priceRange,
  // geo coordinates, or hours — none of those are modeled in the schema).
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

  const quickViewBusiness = {
    id: business.id,
    name: business.name,
    slug: business.slug,
    logo_url: business.logo_url,
    cover_image_url: business.cover_image_url,
    shareUrl: canonicalUrl,
  };

  // ── Public Business V2 composition ────────────────────────────────────
  // Phones: Hero → compact identity/actions → Findmi Here → Bulletin →
  // Products → Findmi Moments → Photos → About → People → Contact & Links →
  // Claim → Discover More. Desktop: the same story in the main column, with
  // identity/actions + Contact & Links + Claim in a compact sticky rail.
  // Every section renders only with real content.

  const coverAndGallery = [business.cover_image_url, ...galleryImages].filter((v): v is string => Boolean(v));
  const contextLine = [
    primaryCategory ? `${primaryCategory.name}${pro && extraCategoryCount > 0 ? ` +${extraCategoryCount}` : ""}` : null,
    location ? `${location}${business.service_radius_miles ? ` · serves within ${business.service_radius_miles} mi` : ""}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const inquireButton = (primary: boolean) => (
    <InquireButton
      targetType="business"
      targetId={business.id}
      targetName={business.name}
      label={inquiryLabel}
      topics={enabledInquiryTopics}
      className={
        primary
          ? "flex h-9 items-center justify-center rounded-full bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600"
          : "flex h-9 items-center justify-center rounded-lg border border-findmi/40 px-3 text-xs font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-findmi-50"
      }
    />
  );

  const identity = (
    <div>
      <div className="flex items-center gap-3">
        {business.logo_url && (
          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-black/[0.06] bg-white">
            <SupabaseImage src={business.logo_url} alt={business.name} fill sizes="48px" className="object-cover" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          {contextLine && <p className="line-clamp-2 text-metadata font-semibold text-secondary">{contextLine}</p>}
          {business.is_featured && (
            <p className="mt-0.5">
              <FeaturedBadge />
            </p>
          )}
        </div>
      </div>
      {business.short_description && (
        <p className="mt-2.5 line-clamp-2 text-body text-secondary">{business.short_description}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <FollowButton businessId={business.id} businessSlug={business.slug} businessName={business.name} size="compact" />
        <SaveButton slug={business.slug} id={business.id} />
        <ShareButton
          url={canonicalUrl}
          title={business.name}
          variant="icon"
          track={{ subject_type: "business", subject_id: business.id, business_id: business.id }}
        />
        {promoteInquire && inquireButton(true)}
      </div>
    </div>
  );

  const contactSection =
    hasCtas || hasContactActions || showMessageButton || (canInquire && !promoteInquire) ? (
      <section id="contact" className="scroll-mt-24">
        <SectionHeading>Contact &amp; Links</SectionHeading>
        <div className="mt-3 flex flex-col gap-3">
          {(showMessageButton || (canInquire && !promoteInquire)) && (
            <div className="flex flex-wrap items-center gap-2">
              {showMessageButton && (
                <MessageButton size="compact" targetType="business" targetId={business.id} targetName={business.name} />
              )}
              {canInquire && !promoteInquire && inquireButton(false)}
            </div>
          )}
          {hasContactActions && (
            <BusinessLinksRow business={{ phone: contact.phone, email: contact.email }} socialLinks={socialLinks} businessId={business.id} />
          )}
          {hasCtas && <BusinessCtaRow business={business} />}
        </div>
      </section>
    ) : null;

  const findmiHereSection = (
    <BusinessFindmiHere
      now={findmiHere.now}
      upcoming={findmiHere.upcoming}
      past={findmiHere.past}
      places={places}
      business={quickViewBusiness}
      galleryImages={galleryImages}
      analyticsContext={{ pageType: "business" }}
    />
  );

  const bulletinSection = hasBulletin ? (
    <section id="bulletin">
      <Bulletin
        label={business.bulletin_label?.trim() || "Announcement"}
        heading={business.bulletin_heading}
        body={business.bulletin_enabled ? business.bulletin_body : null}
        url={business.bulletin_url && validateCustomDestination(business.bulletin_url).ok ? business.bulletin_url : null}
      />
    </section>
  ) : null;

  const productsSection =
    products.length > 0 ? (
      <BusinessShopSection
        products={products}
        business={{ name: business.name, slug: business.slug, logo_url: business.logo_url, commerce_enabled: business.commerce_enabled }}
      />
    ) : null;

  const momentsSection =
    journal.entries.length > 0 ? (
      <section id="moments" className="scroll-mt-24">
        <BrandHeading
          accent="Moments"
          trailing={
            journal.total != null && journal.total > journal.entries.length ? (
              <Link href={journalCollectionHref("business", business.slug)} className="text-metadata font-semibold text-findmi-700 hover:underline">
                See all {journal.total}
              </Link>
            ) : null
          }
        />
        <div className="mt-3">
          <JournalCollection entries={journal.entries} total={journal.total} layout="compact" />
        </div>
      </section>
    ) : null;

  // ImageGalleryStrip hides itself below 2 images; same rule here so no
  // empty heading renders.
  const photosSection =
    galleryImages.length > 1 ? (
      <section id="photos" className="scroll-mt-24">
        <SectionHeading>Photos</SectionHeading>
        <div className="mt-3">
          <ImageGalleryStrip images={galleryImages} alt={business.name} />
        </div>
      </section>
    ) : null;

  const aboutSection =
    business.description && business.description.trim() !== business.short_description?.trim() ? (
      <section id="about" className="scroll-mt-24">
        <SectionHeading>About</SectionHeading>
        <div className="mt-1.5 max-w-2xl">
          <ReadMoreText text={business.description} className="text-body-lg leading-relaxed text-secondary" />
        </div>
      </section>
    ) : null;

  const peopleSection =
    people.length > 0 ? (
      <section id="people" className="scroll-mt-24">
        <SectionHeading>People</SectionHeading>
        <div className="-mx-4 mt-3 sm:-mx-6 lg:mx-0">
          <HorizontalScroller className="lg:px-0">
            {people.map((p) => (
              <div key={p.id} className="w-36 shrink-0 sm:w-40">
                <PersonCard person={p} role={p.role} />
              </div>
            ))}
          </HorizontalScroller>
        </div>
      </section>
    ) : null;

  const discoverSection =
    alternatives.length > 0 ? (
      <section id="discover" className="scroll-mt-24">
        <SectionHeading>Discover More Like This</SectionHeading>
        <div className="-mx-4 mt-3 sm:-mx-6 lg:mx-0">
          <HorizontalScroller className="snap-x snap-mandatory scroll-px-4 sm:scroll-px-6 lg:scroll-px-0 lg:px-0">
            {alternatives.map((alt) => (
              <div key={alt.id} className="w-64 shrink-0 snap-start sm:w-72">
                <BusinessLogoCard business={alt} />
              </div>
            ))}
            <span aria-hidden="true" className="w-px shrink-0" />
          </HorizontalScroller>
        </div>
      </section>
    ) : null;

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
          business (see resolveOwnerPreviewBusiness). */}
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

      {/* Hero — full-bleed cover with the Event page's restrained parallax
          (EventCoverLightbox; static with reduced motion), cover + gallery
          lightbox, name + Verified over a dark lower gradient. No cover →
          a short branded band (no fake photography, no parallax). The logo
          stays out of the moving photo — it leads the identity strip. */}
      <div
        className={`relative w-full overflow-hidden bg-ink sm:rounded-b-3xl ${
          business.cover_image_url
            ? "h-[40vh] max-h-[380px] min-h-[240px] sm:h-auto sm:max-h-[520px] sm:aspect-[21/9]"
            : "h-[150px] sm:h-[190px]"
        }`}
      >
        {business.cover_image_url ? (
          <EventCoverLightbox images={coverAndGallery} alt={business.name} parallax />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-ink to-findmi-900" />
        )}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] p-3 pt-14 sm:p-6 sm:pt-24"
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.6) 30%, rgba(0,0,0,0.2) 62%, rgba(0,0,0,0) 88%)",
          }}
        >
          <div className="mx-auto flex max-w-6xl items-end gap-2 sm:px-0">
            <h1 className="line-clamp-2 font-display text-display font-bold tracking-tight text-white sm:text-display-lg">{business.name}</h1>
            {business.verified && (
              <span className="mb-1.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink">
                <CheckGlyph className="h-2.5 w-2.5 text-findmi-700" />
                Verified
              </span>
            )}
          </div>
        </div>
        <AdminEditButton href={`/admin/businesses/${business.id}`} className="absolute right-3 top-3 z-30" />
      </div>

      {/* Body. Phones: one column in the storytelling order (the desktop
          wrappers are display:contents there, so their children interleave
          via `order`). Desktop: story on the left, a compact sticky rail
          (identity/actions, Contact & Links, Claim) on the right — each
          rendered exactly once. Bottom spacing: no page padding; the last
          block drops its own bottom padding, leaving the shared footer's
          64px. */}
      <div className="mx-auto flex w-full max-w-6xl flex-col px-4 pt-5 sm:px-6 sm:pt-7 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-x-14 lg:pt-10">
        <div className="contents lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1 lg:block lg:self-start">
          <div className="order-1">{identity}</div>
          {contactSection && (
            <div className="order-3 border-t border-black/[0.07] py-7 lg:mt-6 lg:pb-0 lg:pt-5">{contactSection}</div>
          )}
          <div
            className={`order-4 border-t border-black/[0.07] pt-7 empty:hidden lg:mt-6 lg:pb-0 lg:pt-5 ${discoverSection ? "pb-7" : "pb-0"}`}
          >
            {/* Claim placement — same reused flow/modal/eligibility (see
                ClaimButton); renders nothing once claimed/managed. */}
            <ClaimButton type="business" slug={business.slug} entityName={business.name} variant="card" />
          </div>
        </div>
        <div className="contents lg:col-start-1 lg:row-start-1 lg:block">
          <div
            className={`order-2 mt-6 divide-y divide-black/[0.07] border-t border-black/[0.07] [&>*]:py-7 lg:mt-0 lg:border-t-0 lg:[&>*:first-child]:pt-0 ${
              discoverSection ? "" : "lg:[&>*:last-child]:pb-0"
            }`}
          >
            {findmiHereSection}
            {bulletinSection}
            {productsSection}
            {momentsSection}
            {photosSection}
            {aboutSection}
            {peopleSection}
          </div>
          {discoverSection && <div className="order-5 border-t border-black/[0.07] pb-0 pt-7">{discoverSection}</div>}
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
    <div>
      <div className="flex flex-wrap gap-2">
        {ctas.map((cta, i) => (
          <a
            key={i}
            href={cta.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center rounded-xl border border-black/10 bg-white px-3.5 py-2 text-xs font-semibold text-ink/75 transition hover:border-black/20 hover:bg-black/[0.03] hover:text-ink"
          >
            {cta.label}
          </a>
        ))}
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
  className = "",
}: {
  business: { phone: string | null; email: string | null };
  socialLinks: { href: string; label: string; icon: "instagram" | "globe" | "facebook" | "tiktok" }[];
  businessId: string;
  className?: string;
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

function CheckGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
