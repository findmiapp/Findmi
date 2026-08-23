import Image from "next/image";
import Link from "next/link";
import type { BusinessWithCategories } from "@/lib/types";
import { cityState } from "@/lib/format";
import { CategoryPill, VerifiedBadge } from "./Badge";

export default function BusinessCard({
  business,
}: {
  business: BusinessWithCategories;
}) {
  return (
    <Link
      href={`/business/${business.slug}`}
      className="group flex shrink-0 flex-col overflow-hidden rounded-2xl border border-black/5 bg-white transition hover:shadow-lg hover:shadow-black/5"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-black/5">
        {business.cover_image_url && (
          <Image
            src={business.cover_image_url}
            alt={business.name}
            fill
            sizes="(min-width: 768px) 320px, 80vw"
            className="object-cover transition duration-300 group-hover:scale-105"
          />
        )}
        {(business.verified || business.founding_member) && (
          <div className="absolute left-3 top-3">
            <VerifiedBadge founding={business.founding_member} />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-base font-semibold leading-tight text-ink">
            {business.name}
          </h3>
        </div>
        {business.short_description && (
          <p className="line-clamp-2 text-sm text-ink/60">
            {business.short_description}
          </p>
        )}
        <div className="mt-auto flex items-center justify-between pt-2">
          <span className="text-xs font-medium text-ink/50">
            {cityState(business.city, business.state)}
          </span>
          {business.categories[0] && (
            <CategoryPill>{business.categories[0].name}</CategoryPill>
          )}
        </div>
      </div>
    </Link>
  );
}
