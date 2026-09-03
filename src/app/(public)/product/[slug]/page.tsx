import type { Metadata } from "next";
import SupabaseImage from "@/components/SupabaseImage";
import Link from "next/link";
import { notFound } from "next/navigation";
import AddToCartForm from "@/components/AddToCartForm";
import { toJsonLdScript } from "@/lib/jsonLd";
import AdminEditButton from "@/components/AdminEditButton";
import AppearanceCard from "@/components/AppearanceCard";
import FormAction from "@/components/FormAction";
import ProductCard from "@/components/ProductCard";
import ProductSaveButton from "@/components/ProductSaveButton";
import ShareButton from "@/components/ShareButton";
import {
  getFulfillmentOptionsForProduct,
  getProductBySlug,
  getProductsForBusiness,
  getUpcomingAppearancesForBusiness,
} from "@/lib/data";
import { cityState, formatCurrency, formatPrice } from "@/lib/format";
import { resolveProductInquiryForm } from "@/lib/forms";
import { getPublicOrigin } from "@/lib/site-url";

export const revalidate = 60;

// Only http(s) — a founder-typed external_purchase_url is otherwise
// unvalidated (the admin field is a plain type="url" input), so this is
// the actual guard against javascript:/data:/etc rendering as a link.
function isSafeExternalUrl(url: string | null): url is string {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: "Product not found" };

  const description =
    product.description?.trim().slice(0, 160) || `${product.name} from ${product.business.name} on FindMi.`;
  const ogImage = product.image_url ?? product.business.cover_image_url ?? product.business.logo_url ?? undefined;
  const url = `${getPublicOrigin()}/product/${product.slug}`;

  return {
    title: `${product.name} | ${product.business.name} | FindMi`,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: `${product.name} | ${product.business.name}`,
      description,
      images: ogImage ? [ogImage] : undefined,
      url,
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  // Sold-out is a real, admin-set value (inventory_status) — a sold-out
  // product never shows an active Add to Cart, regardless of purchasable/
  // commerce_enabled. "in_stock" and null (not tracked) both allow it.
  const soldOut = product.inventory_status === "out_of_stock";
  const canAddToCart = product.purchasable && product.business.commerce_enabled && !soldOut;

  const [fulfillmentOptions, appearances, sellerProducts, inquiryAction] = await Promise.all([
    canAddToCart ? getFulfillmentOptionsForProduct(product.id) : Promise.resolve([]),
    getUpcomingAppearancesForBusiness(product.business_id, 3),
    getProductsForBusiness(product.business_id),
    resolveProductInquiryForm(product, product.business),
  ]);
  const moreFromSeller = sellerProducts.filter((p) => p.id !== product.id).slice(0, 8);

  // Numeric price first, price_label only when there's no numeric price
  // at all — same precedence ProductCard already established (formatPrice
  // itself is label-first, which is wrong for a real numeric price like
  // 20 rendering as "20" instead of "$20.00" if a stray price_label were
  // ever also set).
  const price = (product.price != null ? formatCurrency(product.price) : formatPrice(product.price, product.price_label)) || null;
  const purchaseUrl = isSafeExternalUrl(product.external_purchase_url) ? product.external_purchase_url : null;
  const canonicalUrl = `${getPublicOrigin()}/product/${product.slug}`;
  const sellerMeta = [product.business.categoryName, cityState(product.business.city, product.business.state)]
    .filter(Boolean)
    .join(" · ");

  // Truthful Product structured data only — no fabricated ratings/SKU/
  // reviews. Offer/price omitted entirely when there's no real numeric
  // price to report.
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    ...(product.image_url ? { image: [product.image_url] } : {}),
    ...(product.description ? { description: product.description } : {}),
    brand: { "@type": "Brand", name: product.business.name },
    ...(product.price != null
      ? {
          offers: {
            "@type": "Offer",
            price: product.price.toFixed(2),
            priceCurrency: "USD",
            availability: soldOut ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
            url: canonicalUrl,
          },
        }
      : {}),
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: toJsonLdScript(jsonLd) }} />

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-10">
        {/* MEDIA — single-image hero, styled like ProductCard's own
            treatment (rounded, bordered, clean) rather than the old
            full-bleed cover-photo style — Part 20: relate visually to the
            homepage cards, not the business profile's cover treatment. */}
        <div className="relative">
          <div className="relative aspect-square w-full overflow-hidden rounded-3xl border border-black/5 bg-mist shadow-sm">
            {product.image_url ? (
              <SupabaseImage
                src={product.image_url}
                alt={product.name}
                fill
                priority
                sizes="(min-width: 1024px) 560px, 100vw"
                className="object-cover"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-ink px-6 text-center">
                <TagGlyph className="h-12 w-12 text-white/20" />
                <span className="line-clamp-2 text-sm font-medium text-white/50">{product.name}</span>
              </div>
            )}
          </div>
          <AdminEditButton href={`/admin/products/${product.id}`} className="absolute right-3 top-3 z-10" />
        </div>

        {/* INFO — sticky on desktop only (never on mobile), so it stays
            visible while scrolling through description/appearances/more-
            products on wide screens without recreating a fixed-bar
            problem on phones. */}
        <div className="mt-6 lg:sticky lg:top-20 lg:mt-0">
          {/* No category badge here — products have no taxonomy of their
              own (see the report); the seller's real category shows
              below, explicitly as seller identity, not product taxonomy. */}
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{product.name}</h1>
          {price && <p className="mt-1.5 text-xl font-bold text-ink">{price}</p>}

          <Link
            href={`/business/${product.business.slug}`}
            className="mt-4 flex items-center gap-3 rounded-2xl border border-black/5 bg-white p-3 transition hover:border-black/10 hover:shadow-sm"
          >
            <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-mist">
              {product.business.logo_url ? (
                <SupabaseImage
                  src={product.business.logo_url}
                  alt={product.business.name}
                  fill
                  sizes="48px"
                  className="object-contain p-1.5"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center bg-ink text-sm font-bold text-white/60">
                  {product.business.name.charAt(0)}
                </span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-ink">{product.business.name}</span>
              {sellerMeta && <span className="block truncate text-xs text-ink/50">{sellerMeta}</span>}
            </span>
            <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-findmi-700">View →</span>
          </Link>

          {/* Primary CTA — exactly one, based on real data: Add to Cart
              wins when actually purchasable; otherwise a valid external
              link; otherwise inquiry; otherwise nothing is fabricated. */}
          <div className="mt-5">
            {canAddToCart ? (
              <AddToCartForm
                productId={product.id}
                options={fulfillmentOptions}
                sourceChannel={`business:${product.business.slug}`}
              />
            ) : purchaseUrl ? (
              <a
                href={purchaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-12 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
              >
                Shop Now
              </a>
            ) : inquiryAction ? (
              <FormAction
                href={inquiryAction.url}
                displayMode={inquiryAction.displayMode}
                label="Contact Seller"
                className="flex h-12 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
              />
            ) : null}

            {soldOut && <p className="mt-2 text-center text-sm font-semibold text-ink/50">Currently sold out</p>}
            {!canAddToCart && !purchaseUrl && !inquiryAction && !soldOut && (
              <p className="text-center text-sm text-ink/45">
                Not available for purchase right now — check back soon.
              </p>
            )}
          </div>

          {/* Fulfillment — only real enabled methods, omitted entirely
              when none exist (e.g. not purchasable). */}
          {fulfillmentOptions.length > 0 && (
            <div className="mt-4 rounded-2xl border border-black/5 bg-black/[0.015] p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-ink/40">How to get it</p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {fulfillmentOptions.map((o, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm text-ink/75">
                    <CheckGlyph className="h-4 w-4 shrink-0 text-findmi-600" />
                    {o.label}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <ProductSaveButton slug={product.slug} />
            <ShareButton url={canonicalUrl} title={product.name} />
          </div>

          {/* Inquiry stays available as a secondary action even when Add
              to Cart is the primary one — existing capability preserved,
              just demoted rather than removed. */}
          {canAddToCart && inquiryAction && (
            <div className="mt-3 text-center">
              <FormAction
                href={inquiryAction.url}
                displayMode={inquiryAction.displayMode}
                label="Ask a question about this product"
                className="text-sm font-semibold text-ink/55 underline underline-offset-2 transition hover:text-ink"
              />
            </div>
          )}
        </div>
      </div>

      {product.description && (
        <section className="mt-10 lg:max-w-2xl">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink">About this product</h2>
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink/70">{product.description}</p>
        </section>
      )}

      {appearances.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink">Find {product.business.name} Here</h2>
          <div className="mt-4 flex flex-col gap-2 lg:max-w-2xl">
            {appearances.map((a) => (
              <AppearanceCard key={a.id} appearance={a} eventSlug={a.event?.slug} />
            ))}
          </div>
          <Link
            href={`/business/${product.business.slug}`}
            className="mt-3 inline-block text-sm font-bold uppercase tracking-wide text-findmi-700"
          >
            View all appearances →
          </Link>
        </section>
      )}

      {moreFromSeller.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink">More from {product.business.name}</h2>
          <div className="-mx-4 mt-4 flex gap-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {moreFromSeller.map((p) => (
              <div key={p.id} className="w-[42%] min-w-[150px] max-w-[176px] shrink-0 sm:w-44">
                <ProductCard product={{ ...p, business: product.business }} />
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="mt-10 flex justify-center sm:justify-start">
        <Link
          href={`/business/${product.business.slug}`}
          className="rounded-full border border-black/10 px-6 py-3 text-sm font-semibold text-ink transition hover:border-ink/30"
        >
          View {product.business.name} on FindMi →
        </Link>
      </div>
    </div>
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

function CheckGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className}>
      <path d="M4 10.5l3.5 3.5L16 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
