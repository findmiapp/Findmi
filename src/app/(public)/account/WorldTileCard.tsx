import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import type { HomeTile } from "@/lib/account-home";

/** Home's mixed-content tile (Saved, From Brands You Follow, Your
 * Moments, Products You Might Like) — lib/account-home.ts's HomeTile.
 * Shared here (not local to one page) so the "From Brands You Follow"
 * client-side filter tabs can reuse the exact same card, never a second
 * card system. */
export type WorldTile = HomeTile;

export const WORLD_KIND_LABEL: Record<WorldTile["kind"], string> = {
  business: "Brand",
  product: "Product",
  event: "Event",
  location: "Place",
  moment: "Moment",
};

export function PlaceFallbackGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M12 21s-7-5.686-7-11a7 7 0 1 1 14 0c0 5.314-7 11-7 11Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

const SIZE = {
  compact: { wrapper: "w-[116px]", sizes: "(min-width: 1024px) 180px, 116px", name: "text-metadata", meta: "text-microcopy" },
  large: { wrapper: "w-[150px]", sizes: "(min-width: 1024px) 220px, 150px", name: "text-body", meta: "text-metadata" },
} as const;

/** Home tile — a real image, the item's real name and what kind of thing
 * it is (plus its Brand / place when known), linking to its own page.
 * `size="large"` is the one presentational variant (From Brands You
 * Follow, which needs a more prominent card) — every other caller keeps
 * the original compact size unchanged. */
export default function WorldTileCard({ tile, size = "compact" }: { tile: WorldTile; size?: "compact" | "large" }) {
  const s = SIZE[size];
  return (
    <Link href={tile.href} className={`group flex ${s.wrapper} shrink-0 snap-start flex-col gap-2 lg:w-auto`}>
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-black/[0.05] bg-black/[0.04]">
        {tile.imageUrl ? (
          <SupabaseImage
            src={tile.imageUrl}
            alt=""
            fill
            sizes={s.sizes}
            className="object-cover transition duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <PlaceFallbackGlyph className="h-6 w-6 text-black/15" />
          </div>
        )}
      </div>
      <div className="min-w-0 px-0.5">
        <p className={`truncate font-bold text-primary ${s.name}`}>{tile.name}</p>
        <p className={`truncate text-subtle ${s.meta}`}>
          {WORLD_KIND_LABEL[tile.kind]}
          {tile.meta ? ` · ${tile.meta}` : ""}
        </p>
      </div>
    </Link>
  );
}
