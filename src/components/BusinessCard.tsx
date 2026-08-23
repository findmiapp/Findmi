import type { BusinessWithCategories } from "@/lib/types";
import { cityState } from "@/lib/format";
import PostCard from "./PostCard";

export default function BusinessCard({
  business,
}: {
  business: BusinessWithCategories;
}) {
  const location = cityState(business.city, business.state);

  return (
    <PostCard
      href={`/business/${business.slug}`}
      image={business.cover_image_url}
      kind="business"
      badgeLabel={business.categories[0]?.name ?? "Business"}
      title={business.name}
      metaLines={location ? [{ icon: "pin", text: location }] : []}
      cta="View Profile"
    />
  );
}
