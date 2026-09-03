import SupabaseImage from "./SupabaseImage";
import Link from "next/link";
import type { BusinessWithCategories } from "@/lib/types";
import type { NextAppearanceHint } from "@/lib/data";
import { cityState, formatDateShort } from "@/lib/format";

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
// NEXT UP link (item 2) nested inside it at a higher z-index so it can
// point somewhere different (the real event) without illegal nested
// <a> tags. Both are plain absolutely/relatively positioned Links in one
// stacking context — the NEXT UP link's z-20 simply wins over the
// stretched link's z-10 within its own small footprint; everywhere else
// on the card still goes to the main href.
export default function BusinessLogoCard({
  business,
  /** UI cleanup pass item 6 (prior pass): this card is now also reused for
   * "Discover More Like This" (business profile) and the event roster's
   * brand preview, both of which want their own CTA copy/destination
   * instead of the Brands We Love default — accepted here rather than
   * hardcoded so neither caller has to fork the card. Defaults preserve
   * exactly what Brands We Love already showed. */
  ctaLabel = "View Profile",
  ctaHref,
  /** Compact "NEXT UP" signal — visual polish pass item 2. Bulk-fetched by
   * the caller (lib/data.ts's getNextAppearanceHints — the same existing
   * appearances architecture /businesses already uses for its own card
   * hint) to avoid N+1 querying per card in a row. Only ever real,
   * already-scheduled data; omitted entirely (not fabricated) when a
   * business has nothing upcoming, or when a caller doesn't pass it at
   * all (Discover More Like This / event roster don't wire this up this
   * pass — see the report). */
  nextAppearance,
}: {
  business: BusinessWithCategories;
  ctaLabel?: string;
  ctaHref?: string;
  nextAppearance?: NextAppearanceHint | null;
}) {
  // Only one category is ever shown — the schema has no subcategory field
  // (see the implementation report), so this never fabricates a second
  // taxonomy level just to fill the "category • category" pattern.
  const meta = [business.categories[0]?.name, cityState(business.city, business.state)].filter(Boolean).join(" · ");
  const hasLogo = Boolean(business.logo_url);
  const hasCover = Boolean(business.cover_image_url);
  const overlap = hasLogo && hasCover;
  const href = ctaHref ?? `/business/${business.slug}`;

  // Visual polish pass item 1: "Featured" dropped entirely from this
  // component's own badge logic — it's redundant the moment this card is
  // already sitting inside a founder-curated/featured row (Brands We
  // Love), and this component has no way to know it's in a DIFFERENT,
  // non-curated context where it might not be. Verified and Founding
  // Member are real, context-independent trust signals, so they take
  // priority over the recency-based New signal.
  const badge = business.verified
    ? "Verified"
    : business.founding_member
      ? "Founding Member"
      : !business.is_featured && Date.now() - new Date(business.created_at).getTime() < 30 * 24 * 60 * 60 * 1000
        ? "New"
        : null;

  return (
    <div className="group relative w-full rounded-3xl border border-black/5 bg-white shadow-sm transition active:scale-[0.98]">
      <Link href={href} aria-label={`${business.name} — ${ctaLabel}`} className="absolute inset-0 z-10 rounded-3xl" />

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

      <div className={`relative flex flex-col gap-1 rounded-b-3xl p-3.5 ${overlap ? "pt-8" : "pt-3"}`}>
        <p className="line-clamp-1 font-display text-base font-bold tracking-tight text-ink">{business.name}</p>
        {meta && <p className="line-clamp-1 text-xs font-medium text-ink/55">{meta}</p>}

        {/* NEXT UP — z-20 beats the stretched link's z-10 within this
            module's own footprint only; everywhere else on the card still
            goes to `href`. Compact (one row), never fabricated. */}
        {nextAppearance &&
          (nextAppearance.href ? (
            <Link
              href={nextAppearance.href}
              className="relative z-20 mt-1 flex items-center gap-1.5 rounded-lg bg-findmi-50 px-2 py-1.5 transition hover:bg-findmi-100"
            >
              <NextUpLabel venue={nextAppearance.venue} startAt={nextAppearance.startAt} />
            </Link>
          ) : (
            <div className="relative mt-1 flex items-center gap-1.5 rounded-lg bg-findmi-50 px-2 py-1.5">
              <NextUpLabel venue={nextAppearance.venue} startAt={nextAppearance.startAt} />
            </div>
          ))}

        <p className="mt-1 flex items-center gap-0.5 text-xs font-bold uppercase tracking-wide text-findmi-700">
          {ctaLabel}
          <ChevronGlyph className="h-3 w-3" />
        </p>
      </div>
    </div>
  );
}

function NextUpLabel({ venue, startAt }: { venue: string; startAt: string }) {
  return (
    <>
      <CalendarGlyph className="h-3.5 w-3.5 shrink-0 text-findmi-700" />
      <span className="min-w-0 flex-1 truncate text-xs text-ink">
        <span className="mr-1.5 font-bold uppercase tracking-wide text-findmi-700">Next Up</span>
        <span className="font-semibold">{venue}</span> · {formatDateShort(startAt)}
      </span>
    </>
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
