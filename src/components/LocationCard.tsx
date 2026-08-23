import type { FindmiLocation } from "@/lib/types";
import { cityState } from "@/lib/format";
import PostCard from "./PostCard";

export default function LocationCard({ location }: { location: FindmiLocation }) {
  return (
    <PostCard
      href={`/location/${location.slug}`}
      image={null}
      kind="location"
      badgeLabel="Location"
      title={location.name}
      metaLines={[
        { icon: "pin", text: [location.address, cityState(location.city, location.state)].filter(Boolean).join(" · ") },
      ]}
      cta="See What's Happening"
    />
  );
}
