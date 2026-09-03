import SupabaseImage from "./SupabaseImage";
import Link from "next/link";
import type { Product } from "@/lib/types";
import { formatCurrency, formatPrice } from "@/lib/format";

export default function ProductCard({
  product,
}: {
  product: Product & {
    /** Selling brand — present on marketplace/homepage/featured product
     * fetches (see FeaturedProduct/MarketplaceProduct in lib/data.ts), not
     * on a business's own product list (redundant there). Purely additive
     * to the card: no business means no brand row, nothing else changes. */
    business?: {
      name: string;
      slug: string;
      logo_url?: string | null;
      categoryName?: string | null;
      /** Master commerce switch (businesses.commerce_enabled) — optional
       * because a caller that doesn't pass `business` at all (e.g. a
       * business's own product list) has nothing to gate on either.
       * Required here, though, whenever `business` IS passed, so this
       * label can't claim "Add to Cart" for a business that hasn't
       * enabled commerce (commerce-audit fix — this used to check
       * `purchasable` alone, disagreeing with the product detail page's
       * real CTA gate: purchasable && commerce_enabled). */
      commerce_enabled?: boolean | null;
    } | null;
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
  // this label is just an honest preview of which one it'll be. Inquiry-
  // only products say "View Details" (this is a discovery card, not the
  // inquiry flow itself) rather than "Ask About This."
  //
  // canAddToCart mirrors the product detail page's real gate exactly
  // (purchasable && business.commerce_enabled) — a card that doesn't carry
  // a `business` (e.g. a business's own product list, where commerce_enabled
  // isn't fetched) falls back to `purchasable` alone rather than assuming
  // false, since that context has no commerce_enabled to check.
  const canAddToCart = product.purchasable && (business ? business.commerce_enabled === true : true);
  const cta = canAddToCart ? "Add to Cart" : product.external_purchase_url ? "Shop Now" : "View Details";
  // Products have no category/taxonomy field of their own — the generic
  // "PRODUCT"/"Service" label is replaced by the selling business's real
  // primary category where available (see FeaturedProduct.business.
  // categoryName in lib/data.ts), falling back to "Service" (still real —
  // product_type) only when there's no category to show, and to nothing
  // at all rather than a fabricated label.
  const badgeLabel = business?.categoryName ?? (product.product_type === "service" ? "Service" : null);
  // A real numeric price gets proper currency formatting ($68.00); a
  // price_label only stands in when there's no numeric price at all
  // ("starting at $450") — never lets a founder-typed shortcut like "$68"
  // hide a perfectly formattable number. Presentation only: nothing about
  // the stored price/price_label values changes.
  const price = (product.price != null ? formatCurrency(product.price) : formatPrice(product.price, product.price_label)) || null;

  // Deliberately NOT built on PostCard's photo-overlay treatment: that
  // layout stacks badge/title/price/CTA as absolutely-positioned text over
  // the image, which collides once the card gets narrow (2-up mobile grid,
  // carousel). Everything below lives in normal document flow instead, so
  // there is no width this can visually break at.
  const card = (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-black/5 bg-white transition active:scale-[0.98]">
      <div className="relative aspect-square w-full shrink-0 bg-mist">
        {product.image_url ? (
          <SupabaseImage
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
        {badgeLabel && <p className="text-[10px] font-bold uppercase tracking-wide text-ink/40">{badgeLabel}</p>}
        <p className="line-clamp-2 font-display text-sm font-semibold leading-snug text-ink">
          {product.name}
        </p>
        {business && (
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-ink/50">
            {business.logo_url && (
              <span className="relative h-4 w-4 shrink-0 overflow-hidden rounded-full bg-black/5">
                <SupabaseImage src={business.logo_url} alt="" fill sizes="16px" className="object-cover" />
              </span>
            )}
            <span className="truncate">{business.name}</span>
          </p>
        )}
        {price && <p className="text-sm font-semibold text-ink/70">{price}</p>}
        {cta && (
          // Launch-polish pass item 5: a hairline divider separates the
          // product info above from the action row, and the CTA itself is
          // now a compact pill (not loose text) so it reads as a distinct
          // action rather than running into the price/title above it. No
          // change to actual cart/checkout behavior — this card still only
          // ever links to the product's own page. Chevron matches the
          // stem-less style standardized this pass (item 4).
          <div className="mt-auto flex items-center border-t border-black/5 pt-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-findmi-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-findmi-700">
              {cta}
              <ChevronGlyph className="h-2.5 w-2.5" />
            </span>
          </div>
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

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
