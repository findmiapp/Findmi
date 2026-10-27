import type { Metadata } from "next";
import { notFound } from "next/navigation";
import GuideView, { resolveGuide } from "@/components/guides/GuideView";
import { buildGuideSections, getGuideSectionRows, getPublishedGuide, guideJsonLd, guideMetadata } from "@/lib/guides";
import { getPublicOrigin } from "@/lib/site-url";
import { toJsonLdScript } from "@/lib/jsonLd";
import { todayIn } from "@/lib/event-time";

// Pages + Sections V1A — a published Guide Page. Public reads only (anon
// client, RLS): a draft, the system Homepage or an unknown slug is a 404.
// Same 60s revalidation as every other public entity page.
export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPublishedGuide(slug);
  if (!page) return { title: "Guide Not Found", robots: { index: false } };
  return guideMetadata(page, getPublicOrigin());
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await getPublishedGuide(slug);
  if (!page) notFound();
  const rows = await getGuideSectionRows(page.id);
  const { sections, items } = await resolveGuide(page, buildGuideSections(rows));
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: toJsonLdScript(guideJsonLd(page, getPublicOrigin(), items)) }} />
      <GuideView page={page} sections={sections} today={todayIn()} />
    </>
  );
}
