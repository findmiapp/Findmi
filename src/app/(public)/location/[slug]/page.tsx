import type { Metadata } from "next";
import { generateLocationMetadata, LocationPublicView } from "./LocationPublicView";

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return generateLocationMetadata(slug);
}

export default async function LocationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <LocationPublicView slug={slug} />;
}
