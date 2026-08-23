import type { Product } from "@/lib/types";
import { formatPrice } from "@/lib/format";
import PostCard from "./PostCard";

export default function ProductCard({
  product,
  businessSlug,
}: {
  product: Product;
  businessSlug?: string;
}) {
  // Prefer sending shoppers straight to an external purchase link. Failing
  // that, still give the card something real to do: jump to the business's
  // own Book / Inquire section instead of sitting there inert.
  const href = product.external_purchase_url
    ? product.external_purchase_url
    : businessSlug
      ? `/business/${businessSlug}#book`
      : null;
  const external = Boolean(product.external_purchase_url);
  const cta = product.external_purchase_url
    ? "Shop Now"
    : businessSlug
      ? "Ask About This"
      : null;

  return (
    <PostCard
      href={href}
      external={external}
      image={product.image_url}
      kind="product"
      badgeLabel={product.product_type === "service" ? "Service" : "Product"}
      title={product.name}
      price={formatPrice(product.price, product.price_label) || null}
      cta={cta}
    />
  );
}
