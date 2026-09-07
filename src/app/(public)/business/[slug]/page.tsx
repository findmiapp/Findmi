import type { Metadata } from "next";
import { BusinessPublicView, generateBusinessMetadata } from "./BusinessPublicView";

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return generateBusinessMetadata(slug);
}

export default async function BusinessPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <BusinessPublicView slug={slug} />;
}
