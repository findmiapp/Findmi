import Image from "next/image";
import Link from "next/link";
import type { BusinessWithCategories } from "@/lib/types";
import { cityState } from "@/lib/format";

// Homepage Featured Brands — logo-forward by design: FindMi is a
// brand/business discovery platform, so the identity mark leads, not a
// small circular afterthought over a cover photo. Falls back to the
// business's cover photo only when it has no logo at all, never an
// invented placeholder mark.
export default function BusinessLogoCard({ business }: { business: BusinessWithCategories }) {
  const meta = [business.categories[0]?.name, cityState(business.city, business.state)].filter(Boolean).join(" · ");
  const mark = business.logo_url ?? business.cover_image_url;

  return (
    <Link
      href={`/business/${business.slug}`}
      className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-black/5 bg-white p-3 transition active:scale-[0.98]"
    >
      <div className="relative aspect-square w-full shrink-0 overflow-hidden rounded-xl bg-mist">
        {mark ? (
          <Image
            src={mark}
            alt={business.name}
            fill
            sizes="(min-width: 768px) 160px, 34vw"
            className={business.logo_url ? "object-contain p-3" : "object-cover"}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-ink">
            <StorefrontGlyph className="h-8 w-8 text-white/25" />
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-col gap-0.5">
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
