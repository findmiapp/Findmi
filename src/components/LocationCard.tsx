import type { LocationWithCategory } from "@/lib/data";
import { cityState } from "@/lib/format";
import PostCard from "./PostCard";

export default function LocationCard({ location }: { location: LocationWithCategory }) {
  const place = cityState(location.city, location.state);
  const upcoming = location.upcomingCount ?? 0;

  return (
    <PostCard
      href={`/location/${location.slug}`}
      image={location.cover_image_url}
      logoUrl={location.logo_url}
      kind="location"
      badgeLabel={location.category?.name ?? "Location"}
      title={location.name}
      metaLines={[
        ...(place ? [{ icon: "pin" as const, text: place }] : []),
        ...(upcoming > 0
          ? [{ icon: "calendar" as const, text: `${upcoming} upcoming` }]
          : []),
      ]}
      cta="See What's Happening"
    />
  );
}
