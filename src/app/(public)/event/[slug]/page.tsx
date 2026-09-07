import type { Metadata } from "next";
import { EventPublicView, generateEventMetadata } from "./EventPublicView";

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return generateEventMetadata(slug);
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <EventPublicView slug={slug} />;
}
