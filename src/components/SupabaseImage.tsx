import Image, { type ImageProps } from "next/image";
import { imageVariantUrl, inferImageSize, type ImageSize, type VariantSize } from "@/lib/image-variants";

// Every DB-driven business/product/event/person/appearance image in this
// app is stored in and served from Supabase Storage (the findmi-media
// bucket) as a *.supabase.co public URL — and Vercel's next/image
// optimizer has repeatedly, verifiably failed to serve those specific
// URLs while the raw file itself is completely valid (root-caused this
// way across HomeEventCard, EventCoverLightbox, ImageGalleryStrip,
// ImageLightbox, and HeaderSearch, one callsite at a time — see each of
// their own comments). Rather than hand-adding `unoptimized` at every
// remaining callsite (and risking missing one, as happened repeatedly),
// this is a drop-in replacement for next/image's <Image>: identical
// props, identical behavior for anything that ISN'T a Supabase Storage
// URL — a local /public asset (Logo.tsx correctly keeps using next/image
// directly for that reason), or a non-Supabase remote host (e.g. Tally's
// vendor-intake images) — it only forces `unoptimized` when `src` is a
// Supabase-hosted URL. A caller that explicitly passes `unoptimized`
// always wins (the already-fixed components above keep their own literal
// `unoptimized` rather than being migrated here, precisely so this stays
// an additive helper, not a rewrite of working code).
//
// Image Performance Foundation — this is also where Findmi's own display
// variants are chosen (lib/image-variants.ts): a Supabase public URL whose
// original has 160/800/1600 WebP variants is swapped for the smallest one
// that suits the slot — `variant` when given, otherwise inferred from the
// caller's existing `sizes`/`width`. Every other URL (existing originals
// without variants, other hosts, local assets) renders exactly as before.
// Fullscreen viewers pass variant="original".
//
// Legacy-variant registry — `registeredVariantSizes` is an OPTIONAL set of
// sizes a legacy (unmarked) findmi-media original has real generated
// variants for, e.g. from a page's own batched media-variants-registry
// lookup (see media-variants-registry.ts). It's ignored for `.fv1.`-marked
// originals (already resolved from the filename alone, no DB involved) and
// for everything else (private/signed URLs, non-Supabase assets) — passing
// it is always safe, never required, and this component never queries
// anything itself to get it.
function isSupabaseStorageUrl(src: ImageProps["src"]): boolean {
  return typeof src === "string" && src.includes(".supabase.co/");
}

export default function SupabaseImage({
  unoptimized,
  variant,
  registeredVariantSizes,
  ...props
}: ImageProps & { variant?: ImageSize; registeredVariantSizes?: ReadonlySet<VariantSize> | null }) {
  const src =
    typeof props.src === "string"
      ? imageVariantUrl(
          props.src,
          variant ?? inferImageSize({ sizes: props.sizes, width: props.width, fill: props.fill }),
          registeredVariantSizes,
        )
      : props.src;
  return <Image {...props} src={src} unoptimized={unoptimized ?? isSupabaseStorageUrl(props.src)} />;
}
