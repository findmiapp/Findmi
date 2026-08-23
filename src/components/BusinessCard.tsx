import type { BusinessWithCategories } from "@/lib/types";
import { cityState, formatDateShort } from "@/lib/format";
import PostCard from "./PostCard";

export default function BusinessCard({
  business,
  /** Optional — the business's next real, upcoming appearance venue/date,
   * e.g. "At Minthorne Market Saturday" (Part 5D). Computed in bulk by the
   * calling page (see getNextAppearanceHints) so a card grid never issues
   * one query per card; omitted entirely when nothing's scheduled rather
   * than fabricating activity. */
  appearanceHint,
}: {
  business: BusinessWithCategories;
  appearanceHint?: { venue: string; startAt: string } | null;
}) {
  const location = cityState(business.city, business.state);

  return (
    <PostCard
      href={`/business/${business.slug}`}
      image={business.cover_image_url}
      logoUrl={business.logo_url}
      kind="business"
      badgeLabel={business.categories[0]?.name ?? "Business"}
      title={business.name}
      metaLines={[
        ...(location ? [{ icon: "pin" as const, text: location }] : []),
        ...(appearanceHint
          ? [{ icon: "calendar" as const, text: `At ${appearanceHint.venue} ${formatDateShort(appearanceHint.startAt)}` }]
          : []),
      ]}
      cta="View Profile"
    />
  );
}
