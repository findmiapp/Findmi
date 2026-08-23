import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import AppearanceCard from "@/components/AppearanceCard";
import BusinessCard from "@/components/BusinessCard";
import ProductCard from "@/components/ProductCard";
import FollowForm from "@/components/FollowForm";
import { CategoryPill, VerifiedBadge } from "@/components/Badge";
import {
  getAlternativeBusinesses,
  getBusinessBySlug,
  getProductsForBusiness,
  getUpcomingAppearancesForBusiness,
} from "@/lib/data";
import { cityState } from "@/lib/format";
import { getInquiryFormUrl } from "@/lib/tally";

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) return { title: "Business not found" };

  return {
    title: business.name,
    description:
      business.short_description ??
      `Discover ${business.name} on Findmi — see what they offer and where they'll be next.`,
    openGraph: {
      title: business.name,
      description: business.short_description ?? undefined,
      images: business.cover_image_url ? [business.cover_image_url] : undefined,
    },
  };
}

export default async function BusinessPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) notFound();

  const [products, appearances, alternatives] = await Promise.all([
    getProductsForBusiness(business.id),
    getUpcomingAppearancesForBusiness(business.id),
    getAlternativeBusinesses(business),
  ]);

  const gallery = Array.from(
    new Set(
      [business.cover_image_url, ...products.map((p) => p.image_url)].filter(
        (v): v is string => Boolean(v)
      )
    )
  ).slice(0, 8);

  const inquiryUrl = getInquiryFormUrl(business);
  const socialLinks = [
    { href: business.website_url, label: "Website" },
    { href: business.instagram_url, label: "Instagram" },
    { href: business.facebook_url, label: "Facebook" },
    { href: business.tiktok_url, label: "TikTok" },
  ].filter((l): l is { href: string; label: string } => Boolean(l.href));

  return (
    <div>
      {/* Cover */}
      <div className="relative h-48 w-full overflow-hidden bg-black/5 sm:h-64 md:h-80">
        {business.cover_image_url && (
          <Image
            src={business.cover_image_url}
            alt={business.name}
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
        )}
      </div>

      <div className="mx-auto max-w-4xl px-6">
        {/* Header */}
        <div className="-mt-12 flex flex-col gap-4 sm:-mt-14 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-end gap-4">
            <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl border-4 border-white bg-white shadow-sm sm:h-28 sm:w-28">
              {business.logo_url && (
                <Image
                  src={business.logo_url}
                  alt={business.name}
                  fill
                  sizes="112px"
                  className="object-cover"
                />
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              {business.name}
            </h1>
            {(business.verified || business.founding_member) && (
              <VerifiedBadge founding={business.founding_member} />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {business.categories.map((c) => (
              <CategoryPill key={c.id}>{c.name}</CategoryPill>
            ))}
            {cityState(business.city, business.state) && (
              <span className="text-sm text-ink/50">
                {cityState(business.city, business.state)}
                {business.service_radius_miles
                  ? ` · serves within ${business.service_radius_miles} mi`
                  : ""}
              </span>
            )}
          </div>
          {business.short_description && (
            <p className="max-w-2xl text-base text-ink/65">{business.short_description}</p>
          )}

          {/* Actions */}
          <div className="mt-2 flex flex-wrap gap-3">
            {inquiryUrl && (
              <a
                href={inquiryUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-findmi-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-findmi-600"
              >
                Book / Inquire
              </a>
            )}
            <a
              href="#follow"
              className="rounded-full border border-black/10 px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-ink/30"
            >
              Follow
            </a>
            {socialLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-black/10 px-5 py-2.5 text-sm font-medium text-ink/70 transition hover:border-ink/30 hover:text-ink"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>

        {/* Findmi Next */}
        {appearances.length > 0 && (
          <section className="mt-12">
            <h2 className="text-lg font-semibold tracking-tight text-ink">Findmi Next</h2>
            <p className="mt-1 text-sm text-ink/55">Upcoming appearances, soonest first.</p>
            <div className="mt-4 flex flex-col gap-3">
              {appearances.map((a) => (
                <AppearanceCard key={a.id} appearance={a} eventSlug={a.event?.slug} />
              ))}
            </div>
          </section>
        )}

        {/* What You'll Find */}
        {products.length > 0 && (
          <section className="mt-12">
            <h2 className="text-lg font-semibold tracking-tight text-ink">What You&rsquo;ll Find</h2>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {products.map((p) => (
                <ProductCard key={p.id} product={p} businessSlug={business.slug} />
              ))}
            </div>
          </section>
        )}

        {/* About */}
        {business.description && (
          <section className="mt-12">
            <h2 className="text-lg font-semibold tracking-tight text-ink">About</h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink/70">
              {business.description}
            </p>
          </section>
        )}

        {/* Gallery */}
        {gallery.length > 0 && (
          <section className="mt-12">
            <h2 className="text-lg font-semibold tracking-tight text-ink">Gallery</h2>
            <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {gallery.map((src) => (
                <div
                  key={src}
                  className="relative aspect-square overflow-hidden rounded-xl bg-black/5"
                >
                  <Image src={src} alt={business.name} fill sizes="200px" className="object-cover" />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Book / Inquire */}
        <section id="book" className="mt-12 scroll-mt-20 rounded-3xl bg-black/[0.03] p-6 sm:p-8">
          <h2 className="text-lg font-semibold tracking-tight text-ink">Book / Inquire</h2>
          <p className="mt-2 max-w-xl text-sm text-ink/60">
            Tell {business.name} what you need — dates, location, and details — and they&rsquo;ll
            follow up directly.
          </p>
          {inquiryUrl ? (
            <a
              href={inquiryUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-block rounded-full bg-ink px-6 py-3 text-sm font-semibold text-white transition hover:bg-findmi-600"
            >
              Start an inquiry
            </a>
          ) : (
            <p className="mt-4 text-sm text-ink/50">Inquiries aren&rsquo;t open yet.</p>
          )}

          {alternatives.length > 0 && (
            <div className="mt-8 border-t border-black/5 pt-6">
              <p className="text-sm font-medium text-ink">
                Not available, or looking for something similar?
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {alternatives.map((alt) => (
                  <BusinessCard key={alt.id} business={alt} />
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Follow */}
        <section id="follow" className="mt-12 mb-16 scroll-mt-20">
          <h2 className="text-lg font-semibold tracking-tight text-ink">
            Want to know where they&rsquo;ll be next?
          </h2>
          <p className="mt-2 max-w-md text-sm text-ink/60">
            Follow {business.name} and we&rsquo;ll keep you posted on new appearances.
          </p>
          <div className="mt-4 max-w-md">
            <FollowForm businessId={business.id} businessName={business.name} />
          </div>
        </section>
      </div>
    </div>
  );
}
