import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/lib/types";
import { formatPrice } from "@/lib/format";

export default function ProductCard({
  product,
}: {
  product: Product & {
    /** Selling brand — present on marketplace/homepage/featured product
     * fetches (see FeaturedProduct/MarketplaceProduct in lib/data.ts), not
     * on a business's own product list (redundant there). Purely additive
     * to the card: no business means no brand row, nothing else changes. */
    business?: { name: string; slug: string; logo_url?: string | null } | null;
  };
  /** @deprecated no longer used for the card's own link — kept optional so
   * existing call sites (which still pass it) don't need updating. The
   * card now always opens the product's own /product/[slug] page, which
   * resolves the business itself. */
  businessSlug?: string;
}) {
  const href = `/product/${product.slug}`;
  const business = product.business;
  // Purchasable wins over an external link — it's the more complete,
  // FindMi-native path (real cart/fulfillment, not a redirect off-site).
  // The card always links to the product's own page either way, where the
  // matching action (Add to Cart form, Shop Now link, or inquiry) lives —
  // this label is just an honest preview of which one it'll be.
  const cta = product.purchasable ? "Add to Cart" : product.external_purchase_url ? "Shop Now" : "Ask About This";
  const badgeLabel = product.product_type === "service" ? "Service" : "Product";
  const price = formatPrice(product.price, product.price_label) || null;

  // Deliberately NOT built on PostCard's photo-overlay treatment: that
  // layout stacks badge/title/price/CTA as absolutely-positioned text over
  // the image, which collides once the card gets narrow (2-up mobile grid,
  // carousel). Everything below lives in normal document flow instead, so
  // there is no width this can visually break at.
  const card = (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-black/5 bg-white transition active:scale-[0.98]">
      <div className="relative aspect-square w-full shrink-0 bg-mist">
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            sizes="(min-width: 768px) 240px, 80vw"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-ink px-4 text-center">
            <TagGlyph className="h-6 w-6 text-white/30" />
            <span className="line-clamp-2 text-xs font-medium text-white/50">{product.name}</span>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="text-[10px] font-bold uppercase tracking-wide text-ink/40">{badgeLabel}</p>
        <p className="line-clamp-2 font-display text-sm font-semibold leading-snug text-ink">
          {product.name}
        </p>
        {business && (
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-ink/50">
            {business.logo_url && (
              <span className="relative h-4 w-4 shrink-0 overflow-hidden rounded-full bg-black/5">
                <Image src={business.logo_url} alt="" fill sizes="16px" className="object-cover" />
              </span>
            )}
            <span className="truncate">{business.name}</span>
          </p>
        )}
        {price && <p className="text-sm font-semibold text-ink/70">{price}</p>}
        {cta && (
          <span className="mt-auto flex items-center gap-1 pt-1 text-xs font-bold uppercase tracking-wide text-findmi-700">
            {cta} <span aria-hidden="true">→</span>
          </span>
        )}
      </div>
    </div>
  );

  return (
    <Link href={href} className="block h-full">
      {card}
    </Link>
  );
}

function TagGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M11.5 4H5a1 1 0 00-1 1v6.5a1 1 0 00.3.7l9 9a1 1 0 001.4 0l6.5-6.5a1 1 0 000-1.4l-9-9a1 1 0 00-.7-.3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="8.2" cy="8.2" r="1.3" fill="currentColor" />
    </svg>
  );
}
