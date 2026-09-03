import Image, { type ImageProps } from "next/image";

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
function isSupabaseStorageUrl(src: ImageProps["src"]): boolean {
  return typeof src === "string" && src.includes(".supabase.co/");
}

export default function SupabaseImage({ unoptimized, ...props }: ImageProps) {
  return <Image {...props} unoptimized={unoptimized ?? isSupabaseStorageUrl(props.src)} />;
}
