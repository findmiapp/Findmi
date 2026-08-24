import Image from "next/image";
import Link from "next/link";
import type { BusinessWithCategories } from "@/lib/types";
import { cityState } from "@/lib/format";

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
// The image sub-block owns its own overflow-hidden/rounded-t-2xl (for
// the cover photo's clipping) — the outer wrapper deliberately does NOT
// clip, so the overlapping logo tile (positioned relative to that outer
// wrapper) can extend past the image's bottom edge instead of being cut
// off by it.
export default function BusinessLogoCard({ business }: { business: BusinessWithCategories }) {
  // Only one category is ever shown — the schema has no subcategory field
  // (see the implementation report), so this never fabricates a second
  // taxonomy level just to fill the "category • category" pattern.
  const meta = [business.categories[0]?.name, cityState(business.city, business.state)].filter(Boolean).join(" · ");
  const hasLogo = Boolean(business.logo_url);
  const hasCover = Boolean(business.cover_image_url);
  const overlap = hasLogo && hasCover;

  // Real, non-fabricated contextual badge: Featured wins (founder-curated
  // editorial signal, same is_featured flag Featured Brands/Brands We
  // Love has always used); otherwise New if the business joined within
  // the last 30 days (real created_at, not a guess).
  const isNew = !business.is_featured && Date.now() - new Date(business.created_at).getTime() < 30 * 24 * 60 * 60 * 1000;
  const badge = business.is_featured ? "Featured" : isNew ? "New" : null;

  return (
    <Link
      href={`/business/${business.slug}`}
      className="block w-full rounded-2xl border border-black/5 bg-white shadow-sm transition active:scale-[0.98]"
    >
      <div className="relative">
        <div className="relative aspect-[16/10] w-full overflow-hidden rounded-t-2xl bg-mist">
          {hasCover ? (
            <Image
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
                <Image
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
          <div className="absolute -bottom-6 left-4 h-16 w-16 overflow-hidden rounded-2xl border-[3px] border-white bg-white shadow-md">
            <Image src={business.logo_url!} alt={business.name} fill sizes="64px" className="object-contain p-1.5" />
          </div>
        )}
      </div>

      <div className={`flex flex-col gap-1 rounded-b-2xl p-4 ${overlap ? "pt-8" : "pt-3.5"}`}>
        <p className="line-clamp-1 font-display text-base font-bold tracking-tight text-ink">{business.name}</p>
        {meta && <p className="line-clamp-1 text-xs font-medium text-ink/55">{meta}</p>}
      </div>
    </Link>
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
