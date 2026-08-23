import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFulfillmentOptionsForProduct, getProductBySlug } from "@/lib/data";
import { formatPrice } from "@/lib/format";
import { getInquiryFormUrl } from "@/lib/tally";
import AddToCartForm from "@/components/AddToCartForm";

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: "Product not found" };

  return {
    title: `${product.name} — ${product.business.name}`,
    description: product.description ?? `${product.name} from ${product.business.name} on FindMi.`,
    openGraph: {
      title: product.name,
      description: product.description ?? undefined,
      images: product.image_url ? [product.image_url] : undefined,
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

  const price = formatPrice(product.price, product.price_label);
  const badgeLabel = product.product_type === "service" ? "Service" : "Product";

  const canAddToCart = product.purchasable && product.business.commerce_enabled;
  const fulfillmentOptions = canAddToCart ? await getFulfillmentOptionsForProduct(product.id) : [];

  const purchaseUrl = product.external_purchase_url;
  const inquiryUrl = getInquiryFormUrl(product.business, { id: product.id, name: product.name });

  return (
    <div>
      <div className="relative h-72 w-full overflow-hidden bg-black/5 sm:h-80 md:h-96">
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-ink">
            <TagGlyph className="h-16 w-16 text-white/15" />
          </div>
        )}
      </div>

      <div className="mx-auto max-w-2xl px-6 py-8">
        <Link
          href={`/business/${product.business.slug}`}
          className="flex items-center gap-2 text-sm font-medium text-ink/60 transition hover:text-ink"
        >
          {product.business.logo_url && (
            <span className="relative h-6 w-6 shrink-0 overflow-hidden rounded-full bg-black/5">
              <Image src={product.business.logo_url} alt={product.business.name} fill sizes="24px" className="object-cover" />
            </span>
          )}
          {product.business.name}
        </Link>

        <p className="mt-3 text-xs font-bold uppercase tracking-wide text-ink/40">{badgeLabel}</p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {product.name}
        </h1>
        {price && <p className="mt-2 text-lg font-semibold text-ink">{price}</p>}

        {product.description && (
          <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-ink/70">
            {product.description}
          </p>
        )}

        {canAddToCart && (
          <div className="mt-6">
            <AddToCartForm
              productId={product.id}
              options={fulfillmentOptions}
              sourceChannel={`business:${product.business.slug}`}
            />
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {/* When Add to Cart is available, the external purchaseUrl button
              is redundant/conflicting and is suppressed — but inquiry stays
              available either way, just demoted from primary to secondary
              (Part 5: "Do not remove existing inquiry capability"). */}
          {!canAddToCart && purchaseUrl ? (
            <a
              href={purchaseUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-findmi px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
            >
              Shop Now
            </a>
          ) : inquiryUrl ? (
            <a
              href={inquiryUrl}
              target="_blank"
              rel="noreferrer"
              className={
                canAddToCart
                  ? "rounded-full border border-black/10 px-5 py-2.5 text-xs font-semibold text-ink/70 transition hover:border-ink/30 hover:text-ink"
                  : "rounded-full bg-findmi px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
              }
            >
              Ask About This
            </a>
          ) : (
            <Link
              href={`/business/${product.business.slug}#book`}
              className={
                canAddToCart
                  ? "rounded-full border border-black/10 px-5 py-2.5 text-xs font-semibold text-ink/70 transition hover:border-ink/30 hover:text-ink"
                  : "rounded-full bg-findmi px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
              }
            >
              Ask About This
            </Link>
          )}
          <Link
            href={`/business/${product.business.slug}`}
            className="rounded-full border border-black/10 px-5 py-2.5 text-xs font-semibold text-ink/70 transition hover:border-ink/30 hover:text-ink"
          >
            View {product.business.name}
          </Link>
        </div>
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
