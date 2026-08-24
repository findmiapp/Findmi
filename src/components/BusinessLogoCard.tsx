import Image from "next/image";
import Link from "next/link";
import type { BusinessWithCategories } from "@/lib/types";
import { cityState } from "@/lib/format";

// Homepage brand card — horizontal/landscape (2026 feed-builder pass):
// logo left (identity, square/rounded, never a tiny circular avatar) +
// cover photo right (storytelling), so a card reads as "this business,
// with a real photo of their space/work" rather than a random gallery
// shot with no brand identity attached. Degrades gracefully rather than
// faking anything: no cover -> logo pane goes full width; no logo ->
// cover pane goes full width; neither -> the same ink/storefront fallback
// the previous version used.
export default function BusinessLogoCard({ business }: { business: BusinessWithCategories }) {
  // Only one category is ever shown — the schema has no subcategory field
  // (see the implementation report), so this never fabricates a second
  // taxonomy level just to fill the "category • category" pattern.
  const meta = [business.categories[0]?.name, cityState(business.city, business.state)].filter(Boolean).join(" · ");
  const hasLogo = Boolean(business.logo_url);
  const hasCover = Boolean(business.cover_image_url);

  // Real, non-fabricated contextual badge: Featured wins (founder-curated
  // editorial signal, same is_featured flag Featured Brands has always
  // used); otherwise New if the business joined within the last 30 days
  // (real created_at, not a guess). No Pop-Up badge — nothing in the
  // schema marks a business as a pop-up specifically.
  const isNew = !business.is_featured && Date.now() - new Date(business.created_at).getTime() < 30 * 24 * 60 * 60 * 1000;
  const badge = business.is_featured ? "Featured" : isNew ? "New" : null;

  return (
    <Link
      href={`/business/${business.slug}`}
      className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-black/5 bg-white transition active:scale-[0.98]"
    >
      <div className="relative flex h-28 w-full shrink-0 sm:h-32">
        {hasLogo && (
          <div
            className={`relative h-full shrink-0 overflow-hidden bg-white ${hasCover ? "w-[34%] border-r border-black/5" : "w-full"}`}
          >
            <Image
              src={business.logo_url!}
              alt={business.name}
              fill
              sizes="(min-width: 768px) 120px, 26vw"
              className="object-contain p-3"
            />
          </div>
        )}
        {hasCover && (
          <div className={`relative h-full overflow-hidden bg-mist ${hasLogo ? "flex-1" : "w-full"}`}>
            <Image
              src={business.cover_image_url!}
              alt=""
              fill
              sizes="(min-width: 768px) 220px, 50vw"
              className="object-cover"
            />
          </div>
        )}
        {!hasLogo && !hasCover && (
          <div className="flex h-full w-full items-center justify-center bg-ink">
            <StorefrontGlyph className="h-8 w-8 text-white/25" />
          </div>
        )}
        {badge && (
          <span className="absolute right-2 top-2 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur-sm">
            {badge}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-3">
        <p className="line-clamp-1 font-display text-sm font-semibold text-ink">{business.name}</p>
        {meta && <p className="line-clamp-1 text-xs text-ink/50">{meta}</p>}
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
