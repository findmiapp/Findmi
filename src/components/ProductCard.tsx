import type { Product } from "@/lib/types";
import { formatPrice } from "@/lib/format";
import PostCard from "./PostCard";

export default function ProductCard({ product }: { product: Product }) {
  const href = product.external_purchase_url ?? null;

  return (
    <PostCard
      href={href}
      external
      image={product.image_url}
      kind="product"
      badgeLabel={product.product_type === "service" ? "Service" : "Product"}
      title={product.name}
      price={formatPrice(product.price, product.price_label) || null}
      cta={href ? "Shop Now" : null}
    />
  );
}
