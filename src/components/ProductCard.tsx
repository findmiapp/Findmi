import Image from "next/image";
import type { Product } from "@/lib/types";
import { formatPrice } from "@/lib/format";

export default function ProductCard({ product }: { product: Product }) {
  const card = (
    <div className="flex shrink-0 flex-col overflow-hidden rounded-2xl border border-black/5 bg-white transition group-hover:shadow-md group-hover:shadow-black/5">
      <div className="relative aspect-square w-full overflow-hidden bg-black/5">
        {product.image_url && (
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            sizes="(min-width: 768px) 240px, 60vw"
            className="object-cover transition duration-300 group-hover:scale-105"
          />
        )}
        {product.product_type === "service" && (
          <span className="absolute left-2 top-2 rounded-full bg-white/95 px-2 py-0.5 text-[10px] font-semibold text-ink">
            Service
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="line-clamp-1 text-sm font-semibold text-ink">{product.name}</p>
        {product.description && (
          <p className="line-clamp-2 text-xs text-ink/55">{product.description}</p>
        )}
        <p className="mt-auto pt-1 text-sm font-semibold text-findmi-600">
          {formatPrice(product.price, product.price_label)}
        </p>
      </div>
    </div>
  );

  if (product.external_purchase_url) {
    return (
      <a
        href={product.external_purchase_url}
        target="_blank"
        rel="noreferrer"
        className="group block"
      >
        {card}
      </a>
    );
  }

  return <div className="group">{card}</div>;
}
