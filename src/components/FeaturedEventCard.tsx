import Image from "@/components/SupabaseImage";
import Link from "next/link";
import FeaturedEventHeroOverlay from "./FeaturedEventHeroOverlay";

/** Premium Featured Event teaser — the Business/Location page's compact
 * counterpart to the Event page's own full-bleed hero, same gradient/
 * overlay visual language (FeaturedEventHeroOverlay), card-scaled. The
 * whole card is ONE Link to the Event's own page — no nested interactive
 * elements, no separate CTA button competing with it. */
export default function FeaturedEventCard({
  href,
  imageUrl,
  imageAlt,
  category,
  title,
  attribution,
  statusLabel,
  isLive,
}: {
  href: string;
  imageUrl: string | null;
  imageAlt: string;
  category: string | null;
  title: string;
  attribution: string | null;
  statusLabel: string | null;
  isLive: boolean;
}) {
  return (
    <Link
      href={href}
      className="relative block aspect-[16/10] w-full overflow-hidden rounded-2xl border border-black/10 bg-ink shadow-sm transition hover:border-black/20"
    >
      {imageUrl ? (
        <Image src={imageUrl} alt={imageAlt} fill unoptimized sizes="(min-width: 640px) 480px, 100vw" className="object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-ink">
          <span className="text-label uppercase tracking-wide text-white/25">Findmi</span>
        </div>
      )}
      <FeaturedEventHeroOverlay
        category={category}
        title={title}
        attribution={attribution}
        statusLabel={statusLabel}
        isLive={isLive}
        description={null}
        compact
        titleTag="h2"
      />
    </Link>
  );
}
