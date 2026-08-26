import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import AdminEditButton from "@/components/AdminEditButton";
import AppearanceCard from "@/components/AppearanceCard";
import BusinessLogoCard from "@/components/BusinessLogoCard";
import BusinessShopSection from "@/components/BusinessShopSection";
import Bulletin from "@/components/Bulletin";
import ImageGalleryStrip from "@/components/ImageGalleryStrip";
import PersonCard from "@/components/PersonCard";
import FollowButton from "@/components/FollowButton";
import SaveButton from "@/components/SaveButton";
import FormAction from "@/components/FormAction";
import { FeaturedBadge, FoundingMemberBadge, NewBadge, VerifiedBadge } from "@/components/Badge";
import type { Business } from "@/lib/types";
import {
  getAlternativeBusinesses,
  getBusinessBySlug,
  getBusinessGalleryImages,
  getPeopleForBusiness,
  getProductsForBusiness,
  getUpcomingAppearancesForBusiness,
} from "@/lib/data";
import { cityState } from "@/lib/format";
import { resolveBusinessInquiryForm } from "@/lib/forms";
import { validateCustomDestination } from "@/lib/navigation";
import { getPublicOrigin } from "@/lib/site-url";

export const revalidate = 60;

function isSafeExternalUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) return { title: "Business not found" };

  const location = cityState(business.city, business.state);
  const description =
    business.description?.trim().slice(0, 160) ||
    business.short_description?.trim().slice(0, 160) ||
    [business.categories[0]?.name, location].filter(Boolean).join(" · ") ||
    `Discover ${business.name} on FindMi.`;
  const ogImage = business.cover_image_url ?? business.logo_url ?? undefined;
  const url = `${getPublicOrigin()}/business/${business.slug}`;

  return {
    title: `${business.name} | FindMi`,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: `${business.name} | FindMi`,
      description,
      images: ogImage ? [ogImage] : undefined,
      url,
    },
  };
}

export default async function BusinessPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) notFound();

  const [products, appearances, alternatives, people, inquiryForm, galleryImages] = await Promise.all([
    getProductsForBusiness(business.id),
    getUpcomingAppearancesForBusiness(business.id),
    getAlternativeBusinesses(business),
    getPeopleForBusiness(business.id),
    resolveBusinessInquiryForm(business),
    getBusinessGalleryImages(business.id),
  ]);

  // "Meet the Owners" only when every configured role genuinely says so —
  // never assumed. Any broader/mixed set of roles gets the honest generic
  // heading instead.
  const allOwnersOrFounders =
    people.length > 0 && people.every((p) => /owner|founder/i.test(p.role ?? ""));
  const peopleHeading = allOwnersOrFounders ? "Meet the Owners" : `Meet the People Behind ${business.name}`;

  // Resolution (Business Profile V2 polish pass, item 4 — a new tier
  // added AHEAD of the existing chain): business's own custom Inquiry
  // CTA (inquiry_cta_url, any external URL — no Tally form required) ->
  // business-specific booking/inquiry form -> global default form ->
  // business email fallback -> graceful unavailable state (see
  // lib/forms.ts's resolveBusinessInquiryForm for that existing DB/env
  // precedence, untouched). Never fabricated; a business with none of
  // these still correctly shows no CTA. The label is independently
  // overridable (inquiry_cta_label) regardless of which URL tier resolves,
  // defaulting to "Inquire" exactly as before when unset.
  const mailtoFallback = business.email
    ? {
        url: `mailto:${business.email}?subject=${encodeURIComponent(`Inquiry via FindMi — ${business.name}`)}`,
        displayMode: "external" as const,
      }
    : null;
  const customInquiryUrl = isSafeExternalUrl(business.inquiry_cta_url) ? business.inquiry_cta_url : null;
  const inquiryAction = customInquiryUrl ? { url: customInquiryUrl, displayMode: "external" as const } : (inquiryForm ?? mailtoFallback);
  const inquiryLabel = business.inquiry_cta_label?.trim() || "Inquire";

  const location = cityState(business.city, business.state);
  // categories[0] is the same "good enough for a compact label" primary-
  // category convention already used elsewhere (BusinessCard, CompactCard)
  // — not a new taxonomy concept. Anything beyond the first is folded into
  // a plain "+N" count rather than flooding the identity block with pills
  // (Business Profile V2, Part 4).
  const primaryCategory = business.categories[0] ?? null;
  const extraCategoryCount = Math.max(0, business.categories.length - 1);
  // Same rule as BusinessLogoCard's own "New" badge — not editorially
  // featured, created within the last 30 days. Reused, not reinvented.
  const isNew = !business.is_featured && Date.now() - new Date(business.created_at).getTime() < 30 * 24 * 60 * 60 * 1000;

  // Compact icon row — website gets its own globe glyph (UI cleanup pass
  // item 5; the old generic chain-link icon read as "some vague URL," not
  // recognizably "this business's website"). Facebook/tiktok still reuse
  // the generic "link" glyph, unchanged this pass — out of this item's
  // explicit scope, not an oversight.
  const socialLinks = [
    { href: business.website_url, label: "Website", icon: "globe" as const },
    { href: business.instagram_url, label: "Instagram", icon: "instagram" as const },
    { href: business.facebook_url, label: "Facebook", icon: "link" as const },
    { href: business.tiktok_url, label: "TikTok", icon: "link" as const },
  ].filter((l): l is { href: string; label: string; icon: "link" | "instagram" | "globe" } => isSafeExternalUrl(l.href));

  const hasDetails = Boolean(
    location || business.service_radius_miles || business.phone || business.email || socialLinks.length > 0
  );

  const canonicalUrl = `${getPublicOrigin()}/business/${business.slug}`;

  // Truthful LocalBusiness JSON-LD — every field is a real, already-public
  // column; nothing here is inferred or fabricated (no ratings, priceRange,
  // geo coordinates, or hours — none of those are modeled in the schema).
  // address only includes locality/region since businesses has no street-
  // address field to draw from.
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
    ...(business.phone ? { telephone: business.phone } : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
    ...(business.city || business.state
      ? {
          address: {
            "@type": "PostalAddress",
            ...(business.city ? { addressLocality: business.city } : {}),
            ...(business.state ? { addressRegion: business.state } : {}),
          },
        }
      : {}),
  };

  return (
    <div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Cover / brand hero — a contained, rounded landscape image (not a
          full-bleed banner), matching Product Detail V2's hero treatment
          so the two page types feel like one app. No fabricated imagery:
          a business with no cover just gets the same branded dark
          placeholder used on the product page. */}
      <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6 sm:pt-6">
        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-3xl border border-black/5 bg-mist shadow-sm sm:aspect-[21/9]">
          {business.cover_image_url ? (
            <Image
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
          {/* Follow/Save positioning micro-fix — the identity strip's own
              box height is now exactly the logo's EXPOSED (below-cover)
              height, not its full height: h-14 (56px) = 96px logo minus
              its 40px overlap offset (mobile); h-16 (64px) = 112px logo
              minus its 48px offset (sm+) — the logo is absolutely
              positioned and pulled up from inside this box, so it can
              still overlap the cover exactly as before, but it no longer
              inflates the box's own footprint the way a normal-flow
              negative-margined flex item did. Follow/Save, absolutely
              positioned to span this box's full (exposed-only) height and
              centered within it, therefore can never sit above y:0 of
              this box — which is the cover's bottom edge — so they can
              never overlap the cover, and read as vertically centered in
              the exposed white strip beside the logo rather than
              centered against the logo's full (partly-hidden) height. */}
          {business.logo_url ? (
            <div className="relative h-14 sm:h-16">
              <div className="absolute -top-10 left-0 h-24 w-24 overflow-hidden rounded-2xl border-4 border-paper bg-white shadow-sm sm:-top-12 sm:h-28 sm:w-28">
                <Image src={business.logo_url} alt={business.name} fill sizes="112px" className="object-cover" />
              </div>
              <div className="absolute inset-y-0 right-0 flex items-center gap-2">
                <div className="w-24">
                  <FollowButton businessId={business.id} businessSlug={business.slug} size="compact" />
                </div>
                <SaveButton slug={business.slug} />
              </div>
            </div>
          ) : (
            // No logo — no cover-overlap concept applies. Follow/Save just
            // sit in normal flow, right-aligned, same controls/sizing.
            <div className="flex items-center justify-end gap-2">
              <div className="w-24">
                <FollowButton businessId={business.id} businessSlug={business.slug} size="compact" />
              </div>
              <SaveButton slug={business.slug} />
            </div>
          )}

          <div className="mt-4 flex flex-col gap-2">
            {/* Item 2 — badges moved OFF the name's own line (they used to
                sit inline with h1, crowding it as soon as 2-3 stacked up)
                onto their own compact, wrapping row underneath. New reuses
                the exact recency rule BusinessLogoCard's own badge already
                uses (not featured, created <30 days) — not a new signal. */}
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{business.name}</h1>
            {(business.verified || business.founding_member || business.is_featured || isNew) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {business.verified && <VerifiedBadge />}
                {business.founding_member && <FoundingMemberBadge />}
                {business.is_featured && <FeaturedBadge />}
                {isNew && <NewBadge />}
              </div>
            )}
            <p className="flex flex-wrap items-center gap-1.5 text-sm text-ink/55">
              {primaryCategory && <span className="font-semibold text-ink/70">{primaryCategory.name}</span>}
              {primaryCategory && extraCategoryCount > 0 && <span className="text-ink/40">+{extraCategoryCount}</span>}
              {primaryCategory && location && <span aria-hidden="true">·</span>}
              {location && (
                <span>
                  {location}
                  {business.service_radius_miles ? ` · serves within ${business.service_radius_miles} mi` : ""}
                </span>
              )}
            </p>
            {business.short_description && <p className="text-base text-ink/65">{business.short_description}</p>}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-12 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-10">
        {/* Right rail on desktop: primary action + Follow/Save, and (desktop
            only) the details/contact block — written first in the DOM so
            it naturally lands right after identity on mobile too. */}
        <div className="mt-6 lg:order-2 lg:sticky lg:top-20 lg:mt-0">
          {/* Item 1: Follow + Save both now live in the identity block
              above — this row is purely Inquire, the single most-
              configurable primary action (item 4's custom URL/label). */}
          {inquiryAction && (
            <div className="min-w-0">
              {inquiryAction.url.startsWith("mailto:") ? (
                <a
                  href={inquiryAction.url}
                  rel="noreferrer"
                  className="flex h-12 w-full items-center justify-center rounded-full bg-findmi px-4 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
                >
                  {inquiryLabel}
                </a>
              ) : (
                <FormAction
                  href={inquiryAction.url}
                  displayMode={inquiryAction.displayMode}
                  label={inquiryLabel}
                  className="flex h-12 w-full items-center justify-center rounded-full bg-findmi px-4 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
                />
              )}
            </div>
          )}

          {hasDetails && <DetailsBlock business={business} location={location} socialLinks={socialLinks} className="mt-6 hidden lg:block" />}
        </div>

        <div className="lg:order-1">
          {/* Items 2/4 — the up-to-3 custom CTAs and the optional Bulletin
              now open the main content column (right after Inquire on
              mobile), well before FindMi Here/Shop/About, instead of
              appearing far down the page after About. */}
          <BusinessCtaRow business={business} />
          <div className="mt-8">
            <Bulletin
              label={business.bulletin_label?.trim() || "Announcement"}
              heading={business.bulletin_heading}
              body={business.bulletin_enabled ? business.bulletin_body : null}
              url={business.bulletin_url && validateCustomDestination(business.bulletin_url).ok ? business.bulletin_url : null}
            />
          </div>
          {/* FindMi Here — the signature feature. Hidden entirely (not an
              empty placeholder) when nothing's scheduled, per Business
              Profile V2 Part 9/32. */}
          {appearances.length > 0 && (
            // mt-6 keeps a clear break from whatever renders above it
            // (CTA row/Bulletin when present, otherwise Inquire itself on
            // mobile); desktop is unaffected (lg:mt-0, separated by the
            // column layout instead).
            <section className="mt-6 lg:mt-0">
              <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">FindMi Here</p>
              <h2 className="mt-1 font-display text-lg font-bold tracking-tight text-ink">Find {business.name} Here</h2>
              <div className="mt-3 flex flex-col gap-2">
                {appearances.slice(0, 3).map((a) => (
                  <AppearanceCard key={a.id} appearance={a} eventSlug={a.event?.slug} />
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
                        <AppearanceCard key={a.id} appearance={a} eventSlug={a.event?.slug} />
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </section>
          )}

          {/* Products — hidden entirely with none, same rule as every other
              optional section on this page. Item 6: now split by real
              purchasable state (BusinessShopSection), and `business` is
              passed through so ProductCard's Add to Cart gate checks the
              real commerce_enabled flag instead of falling back to
              purchasable alone. */}
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
              else it's used. */}
          {galleryImages.length > 1 && (
            <section className="mt-8">
              <h2 className="font-display text-lg font-bold tracking-tight text-ink">Gallery</h2>
              <div className="mt-4">
                <ImageGalleryStrip images={galleryImages} alt={business.name} />
              </div>
            </section>
          )}

          {business.description && (
            <section className="mt-8">
              <h2 className="font-display text-lg font-bold tracking-tight text-ink">About {business.name}</h2>
              <p className="mt-3 max-w-2xl whitespace-pre-line text-sm leading-relaxed text-ink/70">{business.description}</p>
            </section>
          )}

          {/* People — editorial, human; single person gets a stronger
              treatment, multiple people use a horizontal carousel. Never
              rendered empty. */}
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

          {hasDetails && <DetailsBlock business={business} location={location} socialLinks={socialLinks} className="mt-8 lg:hidden" />}

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

/** Compact "Details" block — Business Profile V2 Part 14/8. Rendered twice
 * (once for mobile's later position in the page, once inside the desktop
 * sticky rail) via the `className` prop rather than duplicated markup —
 * each call site just toggles which breakpoint it's visible on. Only
 * fields that are actually set ever render; the whole block is skipped by
 * its caller (`hasDetails`) when nothing real exists. */
function DetailsBlock({
  business,
  location,
  socialLinks,
  className,
}: {
  business: { phone: string | null; email: string | null; service_radius_miles: number | null };
  location: string;
  socialLinks: { href: string; label: string; icon: "link" | "instagram" | "globe" }[];
  className: string;
}) {
  return (
    <section className={className}>
      <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink/40">Details</h2>
      {/* UI cleanup pass item 4: wrapped in a real card (white, thin
          border, soft shadow) instead of plain text floating on the page. */}
      <div className="mt-3 rounded-2xl border border-black/[0.06] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="flex flex-col gap-2.5 text-sm text-ink/70">
          {location && (
            <p className="flex items-center gap-2">
              <PinGlyph className="h-4 w-4 shrink-0 text-ink/40" />
              {location}
              {business.service_radius_miles ? ` · serves within ${business.service_radius_miles} mi` : ""}
            </p>
          )}
          {business.phone && (
            <a href={`tel:${business.phone}`} className="flex items-center gap-2 hover:text-ink">
              <PhoneGlyph className="h-4 w-4 shrink-0 text-ink/40" />
              {business.phone}
            </a>
          )}
          {business.email && (
            <a href={`mailto:${business.email}`} className="flex items-center gap-2 hover:text-ink">
              <MailGlyph className="h-4 w-4 shrink-0 text-ink/40" />
              {business.email}
            </a>
          )}
        </div>
        {socialLinks.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-black/[0.06] pt-3">
            {socialLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                aria-label={link.label}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/10 text-ink/70 transition hover:border-ink/30 hover:text-ink"
              >
                <SocialGlyph icon={link.icon} />
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function SocialGlyph({ icon }: { icon: "link" | "instagram" | "globe" }) {
  if (icon === "instagram") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
        <rect x="3.5" y="3.5" width="17" height="17" rx="5" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="17" cy="7" r="1" fill="currentColor" />
      </svg>
    );
  }
  if (icon === "globe") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
        <ellipse cx="12" cy="12" rx="3.4" ry="8.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3.5 12h17" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <path
        d="M9 15l6-6M11 6.5l1.5-1.5a3.2 3.2 0 014.5 4.5L15.5 11M13 17.5L11.5 19a3.2 3.2 0 01-4.5-4.5L8.5 13"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PinGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M12 21s7-6.2 7-11.5A7 7 0 105 9.5C5 14.8 12 21 12 21z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="9.5" r="2.2" stroke="currentColor" strokeWidth="1.8" />
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
