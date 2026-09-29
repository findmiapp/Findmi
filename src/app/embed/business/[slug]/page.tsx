import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBusinessBySlug, getUpcomingAppearancesForBusiness } from "@/lib/data";
import BusinessEmbedWidget from "./BusinessEmbedWidget";

export const revalidate = 60;

// Embeddable Business Widget Phase 1 — completely generic and
// slug-driven: this route has no knowledge of any specific business.
// Whatever slug resolves to a real, live, non-demo business (the exact
// same getBusinessBySlug the normal /business/[slug] profile already
// uses — no parallel data path) renders; anything else 404s. Swapping
// the test business (e.g. the-native-rose -> illy) is purely a matter of
// which URL/data-findmi-business attribute a site uses, never a code
// change here.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  return {
    title: business?.name ?? "Findmi",
    robots: { index: false, follow: false },
  };
}

export default async function BusinessEmbedPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) notFound();

  // A widget is a quick preview, not the full Where I'll Be schedule —
  // same over-fetch-by-one convention /businesses' own Load More uses,
  // so the widget can truthfully offer "see full schedule on Findmi"
  // only when there's genuinely more than what's shown.
  const WIDGET_APPEARANCE_LIMIT = 5;
  const appearances = await getUpcomingAppearancesForBusiness(business.id, WIDGET_APPEARANCE_LIMIT + 1);
  const hasMoreAppearances = appearances.length > WIDGET_APPEARANCE_LIMIT;

  return (
    <BusinessEmbedWidget
      business={business}
      appearances={appearances.slice(0, WIDGET_APPEARANCE_LIMIT)}
      hasMoreAppearances={hasMoreAppearances}
    />
  );
}
