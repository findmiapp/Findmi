import Image from "next/image";
import { MAX_COLLAGE_REGIONS, collageLayout, collageOverflow } from "@/lib/moment-collage";

/** One preview item. `kind` keeps the abstraction media-, not photo-, shaped
 * so a future video item can occupy a region; today every item is a real
 * photo and only "image" is rendered. */
export interface CollageMediaItem {
  kind: "image";
  url: string;
  alt?: string;
}

export type CollageVariant = "hero" | "card" | "compact";

/** Width ÷ height per variant. Fixed so the collage reserves its exact space
 * before any image loads (no layout shift). */
export const COLLAGE_ASPECT: Record<CollageVariant, number> = { hero: 16 / 10, card: 5 / 4, compact: 4 / 3 };

/** Findmi Moment media collage — the signature preview for a Moment.
 *
 * Geometry comes from lib/moment-collage.ts (deterministic polygons for 1–5
 * photos). Each region is an absolutely-positioned box at its polygon's
 * bounding box, clipped to the polygon with CSS clip-path; its photo fills
 * THAT box (object-fit: cover), so every photo is framed for its own region
 * and never rotated. The thin seams between regions show the collage
 * background; the outer rounded rectangle clips everything. More photos
 * than regions → a "+N" overlay on the last region. */
export default function MomentMediaCollage({
  items,
  total,
  variant = "card",
  sizes,
  priority = false,
  className = "",
  label,
}: {
  items: CollageMediaItem[];
  /** The Moment's full photo count (for "+N"). */
  total: number;
  variant?: CollageVariant;
  /** `sizes` for the hero region; supporting regions use a fraction of it. */
  sizes?: string;
  priority?: boolean;
  className?: string;
  /** Accessible description of the whole collage (e.g. the Moment title). */
  label?: string;
}) {
  const aspect = COLLAGE_ASPECT[variant];
  const shown = items.slice(0, MAX_COLLAGE_REGIONS);
  const regions = shown.length > 0 ? collageLayout(shown.length, aspect) : [];
  const overflow = collageOverflow(total, shown.length);
  const heroSizes = sizes ?? "(min-width: 1024px) 420px, (min-width: 640px) 50vw, 86vw";

  return (
    <div
      role="img"
      aria-label={label ? `${label} — ${total} photo${total === 1 ? "" : "s"}` : undefined}
      className={`relative w-full overflow-hidden rounded-2xl bg-white ${className}`}
      style={{ aspectRatio: `${aspect}` }}
    >
      {shown.length === 0 && <div className="absolute inset-0 bg-black/[0.05]" />}
      {regions.map((reg, i) => {
        const item = shown[i];
        const last = i === shown.length - 1;
        return (
          <div
            key={i}
            className="absolute overflow-hidden bg-black/[0.06]"
            style={{
              left: `${reg.box.left}%`,
              top: `${reg.box.top}%`,
              width: `${reg.box.width}%`,
              height: `${reg.box.height}%`,
              clipPath: shown.length > 1 ? reg.clipPath : undefined,
            }}
          >
            <Image
              src={item.url}
              alt=""
              fill
              unoptimized
              priority={priority && i === 0}
              loading={priority && i === 0 ? undefined : "lazy"}
              sizes={i === 0 ? heroSizes : "(min-width: 640px) 25vw, 40vw"}
              className="object-cover"
            />
            {last && overflow != null && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-lg font-bold tracking-tight text-white">
                +{overflow}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
