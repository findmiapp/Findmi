"use client";

import SupabaseImage from "./SupabaseImage";
import Link from "next/link";
import FollowButton from "./FollowButton";
import WantHeartButton from "./WantHeartButton";
import type { BusinessWithCategories } from "@/lib/types";
import type { NextAppearanceHint } from "@/lib/data";
import { cityState, formatDateShort, formatTime, isTimeUnknown } from "@/lib/format";
import { trackEvent } from "@/lib/analytics/track";
import { useViewportImpression } from "@/lib/analytics/useViewportImpression";
import { buildEntityEventFields, type AnalyticsPlacementContext } from "@/lib/analytics/context";

// Homepage brand card — full landscape composition (live-QA redesign,
// 2026 nav pass, Part 9/10): the earlier 1/3-logo | 2/3-cover split read
// as "two random images side by side," not one composed brand card. This
// version leads with a full-width cover/gallery photo (what the place
// feels like), with the logo overlapping its lower-left corner as a
// larger rounded-square identity tile (who it is) — same relationship a
// lot of consumer discovery apps use for exactly this reason: one strong
// photo, one unmistakable mark anchoring it, not two competing images.
// Never a tiny circular avatar. Degrades honestly by what's actually
// there: logo+cover overlaps as above; logo-only expands to fill the
// whole visual area (no photo to lead with, so the mark IS the visual);
// cover-only skips the overlap entirely; neither falls back to the same
// ink/storefront treatment as before.
//
// Visual polish pass rebuild: the card is no longer one big <Link> —
// it's a <div> with a stretched, invisible Link covering the whole card
// (item 3's default View Profile / ctaHref action), plus an optional
// appearance-preview module (item 2) nested inside it at a higher
// z-index so its own links can point somewhere different (a real event,
// or the business's own appearances section) without illegal nested
// <a> tags. All of these are plain absolutely/relatively positioned
// Links in one stacking context — each one's z-20 simply wins over the
// stretched link's z-10 within its own small footprint; everywhere else
// on the card still goes to `href`.
//
// Business Card Redesign pass — the single "Next Up" pill is replaced by
// a fuller appearance-preview module (still the SAME real, bulk-fetched
// appearance data via lib/data.ts's getUpcomingAppearanceHints — never a
// second/competing "upcoming" definition, never invented content):
// exactly one eligible upcoming appearance renders as one wide preview
// card; two or more render as a horizontal rail of compact preview
// cards, same AppearanceMiniCard grammar either way (see its own
// comment). Zero eligible appearances renders no module at all — a clean
// identity/discovery card, same as before this pass, now also showing a
// real business.short_description line when one exists (never invented).
export default function BusinessLogoCard({
  business,
  /** UI cleanup pass item 6 (prior pass): this card is now also reused for
   * "Discover More Like This" (business profile) and the event roster's
   * brand preview, both of which want their own CTA copy/destination
   * instead of the Brands We Love default — accepted here rather than
   * hardcoded so neither caller has to fork the card. Defaults preserve
   * what Brands We Love already showed. Business Card Redesign pass —
   * default copy updated from "View Profile" to "View Brand" (consumer
   * discovery-card terminology; the destination itself is unchanged). */
  ctaLabel = "View Brand",
  ctaHref,
  /** Business Card Redesign pass — plural (was a single `nextAppearance`
   * hint). Bulk-fetched by the caller (lib/data.ts's
   * getUpcomingAppearanceHints — the same existing appearances
   * architecture, extended to return several per business instead of
   * just the soonest one) to avoid N+1 querying per card in a row. Only
   * ever real, already-scheduled appearances; omitted entirely (not
   * fabricated) when a business has nothing upcoming, or when a caller
   * doesn't wire this up at all (e.g. the event roster's brand preview,
   * and the business profile's own "Discover More Like This" rail, both
   * of which still work fine without it — a clean identity card is a
   * perfectly good state, never a placeholder). */
  upcomingAppearances,
  /** Gallery-Image Fallback experiment — the business's own existing
   * gallery (business_images), bulk-fetched by the caller (lib/data.ts's
   * getBusinessGalleryImagesMap, same batched-query discipline as
   * upcomingAppearances) so an image-less occurrence mini-card can borrow
   * real business photography instead of the plain aqua/logo placeholder.
   * Purely a read-time display choice — never written onto the
   * appearance/event record itself. Omitted or empty behaves exactly as
   * before this pass (the designed fallback). */
  galleryImages,
  analyticsContext,
}: {
  business: BusinessWithCategories;
  ctaLabel?: string;
  ctaHref?: string;
  upcomingAppearances?: NextAppearanceHint[];
  galleryImages?: string[];
  analyticsContext?: AnalyticsPlacementContext;
}) {
  // Only one category is ever shown — the schema has no subcategory field
  // (see the implementation report), so this never fabricates a second
  // taxonomy level just to fill the "category • category" pattern.
  //
  // Preview Card Polish pass item 4 — kept as two separate values (not one
  // joined "meta" string) so the category can truncate independently of
  // the city/state, which must never be cut off. See the render below.
  const category = business.categories[0]?.name ?? null;
  const locationLabel = cityState(business.city, business.state);
  const hasLogo = Boolean(business.logo_url);
  const hasCover = Boolean(business.cover_image_url);
  const overlap = hasLogo && hasCover;
  const href = ctaHref ?? `/business/${business.slug}`;
  const appearancesHref = `/business/${business.slug}#findmi-here`;
  const upcoming = upcomingAppearances ?? [];

  // Gallery-Image Fallback experiment — deterministic, render-time-only
  // rotation across the business's own gallery: only an appearance that
  // has NO real image of its own consumes/advances a gallery slot, so an
  // appearance with a real image is untouched and never shifts what the
  // OTHER image-less appearances show. Stable across renders (no Math.
  // random) and naturally repeats the same single image when the gallery
  // only has one, or falls through to null (the existing designed
  // fallback) once the gallery itself is empty.
  const gallery = galleryImages ?? [];
  let galleryCursor = 0;
  const galleryFallbackFor = (item: NextAppearanceHint): string | null => {
    if (item.imageUrl || gallery.length === 0) return null;
    const url = gallery[galleryCursor % gallery.length];
    galleryCursor += 1;
    return url;
  };

  const analyticsFields = buildEntityEventFields("business", business.id, { businessId: business.id }, analyticsContext);
  const impressionRef = useViewportImpression<HTMLDivElement>({ event_name: "entity_impression", ...analyticsFields });

  // Visual polish pass item 1: "Featured" dropped entirely from this
  // component's own badge logic — it's redundant the moment this card is
  // already sitting inside a founder-curated/featured row (Brands We
  // Love), and this component has no way to know it's in a DIFFERENT,
  // non-curated context where it might not be.
  //
  // Remove Consumer-Facing Plan Status pass — Pro Member/Founding Member
  // no longer render here: paid plan status is a commercial relationship
  // with FindMi, not a consumer discovery attribute. is_pro_member/
  // founding_member remain real, unchanged fields (still used by account/
  // admin/billing/entitlement resolution) — only this public badge
  // presentation is removed. The one remaining signal, recency-based
  // "New" (never alongside is_featured), is a truthful non-plan state and
  // is preserved exactly as before.
  const badge =
    !business.is_featured && Date.now() - new Date(business.created_at).getTime() < 30 * 24 * 60 * 60 * 1000
      ? "New"
      : null;

  return (
    <div ref={impressionRef} className="group relative w-full rounded-3xl border border-black/5 bg-white shadow-sm transition active:scale-[0.98]">
      <Link
        href={href}
        aria-label={`${business.name}: ${ctaLabel}`}
        className="absolute inset-0 z-10 rounded-3xl"
        onClick={() => trackEvent({ event_name: "entity_click", ...analyticsFields })}
      />

      <div className="relative">
        <div className="relative aspect-[16/10] w-full overflow-hidden rounded-t-3xl bg-mist">
          {hasCover ? (
            <SupabaseImage
              src={business.cover_image_url!}
              alt=""
              fill
              sizes="(min-width: 768px) 384px, 80vw"
              className="object-cover"
            />
          ) : hasLogo ? (
            // Logo-only: no photo to lead with, so the mark itself fills
            // the visual area — large and centered, not a small tile.
            <div className="flex h-full w-full items-center justify-center bg-findmi-50 p-8">
              <div className="relative h-full w-full">
                <SupabaseImage
                  src={business.logo_url!}
                  alt={business.name}
                  fill
                  sizes="(min-width: 768px) 384px, 80vw"
                  className="object-contain"
                />
              </div>
            </div>
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-ink">
              <StorefrontGlyph className="h-10 w-10 text-white/25" />
            </div>
          )}

          {badge && (
            <span className="absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur-sm">
              {badge}
            </span>
          )}
        </div>

        {overlap && (
          // Launch-polish pass item 3 — real fix, not another border-width
          // tweak: the previous version's p-1.5 inset on the Image kept the
          // logo's own pixels away from the tile's rounded clip, so
          // whatever the source file's actual edge looked like (very often
          // an opaque/near-white square canvas around the mark) stayed
          // fully visible, reading as "a square logo pasted into a big
          // rounded frame." Padding is removed entirely here so the tile's
          // rounded-2xl clip cuts directly into the image itself — the
          // rounding is now genuinely applied to the logo, not just to an
          // outer box around it. The frame is also thinned from a solid
          // border-2 to a hairline ring (no separate bg-white plate behind
          // it), and the tile itself is smaller (h-24→h-20), which
          // together removes most of the dead white space this was flagged
          // for. object-contain is kept (not object-cover) so no logo is
          // ever cropped or distorted — transparent-background logos still
          // read cleanly against the tile's own white fill.
          <div className="absolute -bottom-7 left-5 h-20 w-20 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-white">
            <SupabaseImage src={business.logo_url!} alt={business.name} fill sizes="80px" className="object-contain" />
          </div>
        )}
      </div>

      <div className="relative flex flex-col gap-1 rounded-b-3xl p-3.5">
        {/* Preview Card Polish pass item 3 — Follow + Save, reusing the
            exact production components (no duplicate state systems). This
            row is deliberately right-aligned and sits ABOVE the business
            name: the overlapping logo tile (absolutely positioned against
            the cover section above, left-5/w-20) pokes down at most 28px
            into this block on the left — since this row is right-aligned
            it never collides with it horizontally, and its own height
            gives the name below all the vertical clearance the old
            overlap-only pt-8 hack used to provide by itself, so that hack
            is retired in favor of this real content doing the same job. */}
        <div className="relative z-20 flex h-9 items-center justify-end gap-1.5">
          <FollowButton businessId={business.id} businessSlug={business.slug} businessName={business.name} size="compact" />
          <WantHeartButton
            type="business"
            slug={business.slug}
            id={business.id}
            className="h-9 w-9 shrink-0 !bg-findmi-50 !text-findmi-700"
          />
        </div>

        <p className="line-clamp-1 font-display text-base font-bold tracking-tight text-ink">{business.name}</p>
        {(category || locationLabel) && (
          <div className="flex min-w-0 items-center gap-1 text-xs font-medium text-ink/55">
            {category && <span className="min-w-0 flex-1 truncate">{category}</span>}
            {category && locationLabel && <span className="shrink-0">·</span>}
            {locationLabel && <span className="shrink-0 whitespace-nowrap">{locationLabel}</span>}
          </div>
        )}

        {/* Business Card Redesign pass — a business with nothing upcoming
            gets no module at all (never an empty container/fake entry).
            Only real, truthful body content here: the business's own
            short_description, when one actually exists — never invented
            copy, never a placeholder tagline. */}
        {upcoming.length === 0 && business.short_description && (
          <p className="line-clamp-2 text-xs text-ink/60">{business.short_description}</p>
        )}

        {upcoming.length > 0 && (
          <div className="relative z-20 mt-1.5 rounded-2xl bg-findmi-50 p-2.5">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-findmi-700">
              <CalendarGlyph className="h-3.5 w-3.5 shrink-0" />
              {upcoming.length === 1 ? "1 Upcoming Appearance" : `${upcoming.length} Upcoming Appearances`}
            </p>

            {upcoming.length === 1 ? (
              <div className="mt-2">
                <AppearanceMiniCard
                  item={upcoming[0]}
                  size="wide"
                  fallbackHref={appearancesHref}
                  businessLogoUrl={business.logo_url}
                  galleryFallbackUrl={galleryFallbackFor(upcoming[0])}
                />
              </div>
            ) : (
              <div className="mt-2 flex gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {upcoming.map((item, i) => (
                  <AppearanceMiniCard
                    key={i}
                    item={item}
                    size="compact"
                    fallbackHref={appearancesHref}
                    businessLogoUrl={business.logo_url}
                    galleryFallbackUrl={galleryFallbackFor(item)}
                  />
                ))}
              </div>
            )}

            <Link
              href={upcoming.length === 1 ? (upcoming[0].href ?? appearancesHref) : appearancesHref}
              className="relative z-20 mt-2 flex items-center gap-0.5 text-[11px] font-bold uppercase tracking-wide text-findmi-700"
            >
              {upcoming.length === 1 ? "View appearance" : "See all appearances"}
              <ChevronGlyph className="h-2.5 w-2.5" />
            </Link>
          </div>
        )}

        <p className="mt-1 flex items-center gap-0.5 text-xs font-bold uppercase tracking-wide text-findmi-700">
          {ctaLabel}
          <ChevronGlyph className="h-3 w-3" />
        </p>
      </div>
    </div>
  );
}

/** Business Card Redesign pass — the one mini-card grammar shared by both
 * the single-appearance ("wide") and multiple-appearance ("compact")
 * states: same rounded tile, same image-then-title-then-date stack, same
 * real image-fallback rules. `size` only changes proportions (width, text
 * size) — never the structure — so "single is the same card, just wider"
 * holds literally, not just in spirit.
 *
 * Preview Card Polish pass item 2 — the image area and text block below
 * it now use FIXED pixel heights (h-24 / h-16) instead of the old
 * aspect-ratio classes (aspect-[21/9] wide vs aspect-[4/3] compact), which
 * produced different absolute pixel heights at their different absolute
 * widths — the direct cause of "wide" (single-appearance) cards rendering
 * taller than "compact" (multi-appearance) ones. Both variants also now
 * share the same vertical padding (py-2) so the two states are pixel-
 * identical in total height regardless of how many lines of real text a
 * given item actually has (the text block is overflow-hidden).
 *
 * Real destination only: the related Event's page when event-backed and
 * real (never a demo event, never a fabricated /appearance/[id] route);
 * otherwise the business's own real, already-existing appearances
 * section (`fallbackHref`, `/business/[slug]#findmi-here`) — never a
 * dead, non-interactive preview. A plain sibling <Link> at z-20 (not
 * nested inside the card's own stretched <Link>), same non-nesting
 * pattern this card's CTA/appearance links already use. */
function AppearanceMiniCard({
  item,
  size,
  fallbackHref,
  businessLogoUrl,
  galleryFallbackUrl,
}: {
  item: NextAppearanceHint;
  size: "wide" | "compact";
  fallbackHref: string;
  /** Preview Card Polish pass item 1 — only used as a subtle, low-opacity
   * watermark inside the designed fallback below, never as a substitute
   * photo and never repeated to imply photography that doesn't exist. */
  businessLogoUrl: string | null;
  /** Gallery-Image Fallback experiment — a real business_images URL,
   * already resolved by BusinessLogoCard's deterministic rotation (null
   * when this item has its own real image, the gallery is empty, or the
   * caller didn't wire galleryImages at all). Rendered with the exact same
   * container/object-fit as a genuine occurrence image below — the viewer
   * should never be able to tell it apart visually from real event/flyer
   * art; only the precedence order (real image first) keeps it honest. */
  galleryFallbackUrl: string | null;
}) {
  const href = item.href ?? fallbackHref;
  const wide = size === "wide";
  // Preview Card Polish pass item 5 — only real, already-fetched fields;
  // a line is omitted entirely (not shown blank) when the underlying data
  // doesn't exist, never fabricated. isTimeUnknown/formatTime are the same
  // Appearance-time helpers AppearanceCard already uses, so an importer
  // "Time TBD" placeholder (see format.ts) never renders as a fake exact
  // time here either.
  const dateTime = isTimeUnknown(item.description)
    ? formatDateShort(item.startAt)
    : `${formatDateShort(item.startAt)} · ${formatTime(item.startAt)}`;
  const venueLine = [item.venueName, cityState(item.city, item.state)].filter(Boolean).join(" · ");

  return (
    <Link
      href={href}
      className={`relative z-20 flex shrink-0 flex-col overflow-hidden rounded-xl border border-black/5 bg-white transition active:scale-[0.97] ${
        wide ? "w-full" : "w-28"
      }`}
    >
      <div className="relative h-24 w-full shrink-0 overflow-hidden bg-black/5">
        {item.imageUrl ? (
          <SupabaseImage
            src={item.imageUrl}
            alt=""
            fill
            sizes={wide ? "(min-width: 768px) 360px, 80vw" : "112px"}
            className="object-cover"
          />
        ) : galleryFallbackUrl ? (
          // Gallery-Image Fallback experiment — the business's own existing
          // gallery photo, same container/object-fit as a real occurrence
          // image. Presentational only: this is never written back onto
          // the appearance record, so a real image added later takes over
          // automatically with no cleanup needed.
          <SupabaseImage
            src={galleryFallbackUrl}
            alt=""
            fill
            sizes={wide ? "(min-width: 768px) 360px, 80vw" : "112px"}
            className="object-cover"
          />
        ) : (
          // Preview Card Polish pass item 1 — a designed FindMi fallback,
          // never a black rectangle: a soft aqua surface, the business's
          // own logo faintly watermarked behind (when one exists — real
          // identity data, not invented art), and a restrained calendar
          // glyph. Real appearance imagery always wins when it exists;
          // this only renders when it genuinely doesn't.
          <div className="relative flex h-full w-full items-center justify-center bg-findmi-50">
            {businessLogoUrl && (
              <div className="absolute inset-0 flex items-center justify-center opacity-[0.14]">
                <div className="relative h-14 w-14">
                  <SupabaseImage src={businessLogoUrl} alt="" fill sizes="56px" className="object-contain" />
                </div>
              </div>
            )}
            <CalendarGlyph className="relative h-5 w-5 text-findmi-600/70" />
          </div>
        )}
      </div>
      <div className={`flex h-16 flex-col justify-center gap-0.5 overflow-hidden ${wide ? "px-3 py-2" : "px-2 py-2"}`}>
        <p className={`truncate font-semibold leading-tight text-ink ${wide ? "text-sm" : "text-[11px]"}`}>
          {item.venue}
        </p>
        <p className={`truncate leading-tight text-ink/50 ${wide ? "text-xs" : "text-[10px]"}`}>{dateTime}</p>
        {venueLine && (
          <p className={`truncate leading-tight text-ink/40 ${wide ? "text-[11px]" : "text-[9px]"}`}>{venueLine}</p>
        )}
      </div>
    </Link>
  );
}

function CalendarGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

// Launch-polish pass item 4 — the same stem-less chevron already
// established in AppearanceCard's ArrowGlyph, standardized here too.
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
