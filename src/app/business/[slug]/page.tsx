import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import AppearanceCard from "@/components/AppearanceCard";
import BusinessCard from "@/components/BusinessCard";
import ProductCard from "@/components/ProductCard";
import FollowForm from "@/components/FollowForm";
import SaveButton from "@/components/SaveButton";
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
      `Discover ${business.name} on FindMi — see what they offer and where they'll be next.`,
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
    { href: business.website_url, label: "Website", icon: "link" as const },
    { href: business.instagram_url, label: "Instagram", icon: "instagram" as const },
    { href: business.facebook_url, label: "Facebook", icon: "link" as const },
    { href: business.tiktok_url, label: "TikTok", icon: "link" as const },
  ].filter((l): l is { href: string; label: string; icon: "link" | "instagram" } =>
    Boolean(l.href)
  );

  return (
    <div>
      {/* A. Immersive cover */}
      <div className="relative h-52 w-full overflow-hidden bg-black/5 sm:h-64 md:h-80">
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
        {/* B. Business identity */}
        <div className="-mt-12 flex flex-col gap-4 sm:-mt-14 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-end gap-4">
            <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl border-4 border-paper bg-white shadow-sm sm:h-28 sm:w-28">
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
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
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

          {/* C. Primary action — Follow Their Moves — plus restrained utility controls */}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <a
              href="#follow"
              className="rounded-full bg-findmi px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-ink transition hover:bg-findmi-600"
            >
              Follow Their Moves
            </a>
            <SaveButton slug={business.slug} />
            {socialLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                aria-label={link.label}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-black/10 text-ink/70 transition hover:border-ink/30 hover:text-ink"
              >
                <SocialGlyph icon={link.icon} />
              </a>
            ))}
          </div>
        </div>

        {/* D. FindMi Here — the signature feature. Always present, even with
            nothing scheduled, so the concept stays visible on every profile. */}
        <section className="mt-10 rounded-3xl border border-findmi/30 bg-findmi-50 p-5 sm:p-6">
          <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">
            FindMi Here
          </p>
          <h2 className="mt-1 font-display text-xl font-bold tracking-tight text-ink">
            Where {business.name} will be
          </h2>
          {appearances.length > 0 ? (
            <div className="mt-4 flex flex-col gap-3">
              {appearances.map((a) => (
                <AppearanceCard key={a.id} appearance={a} eventSlug={a.event?.slug} />
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl bg-white p-5">
              <p className="text-sm text-ink/60">
                Nothing announced yet. Follow their moves and we&rsquo;ll let you know
                where to find them next.
              </p>
              <a
                href="#follow"
                className="mt-3 inline-block rounded-full bg-findmi px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-ink transition hover:bg-findmi-600"
              >
                Follow Their Moves
              </a>
            </div>
          )}
        </section>

        {/* E. What You'll Find */}
        {products.length > 0 && (
          <section className="mt-12">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink">
              What You&rsquo;ll Find
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {products.map((p) => (
                <ProductCard key={p.id} product={p} businessSlug={business.slug} />
              ))}
            </div>
          </section>
        )}

        {/* F. About */}
        {business.description && (
          <section className="mt-12">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink">About</h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink/70">
              {business.description}
            </p>
          </section>
        )}

        {/* G. Gallery */}
        {gallery.length > 0 && (
          <section className="mt-12">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink">Gallery</h2>
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

        {/* H. Book / Inquire */}
        <section id="book" className="mt-12 scroll-mt-20 rounded-3xl bg-black/[0.03] p-6 sm:p-8">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink">
            Book / Inquire
          </h2>
          <p className="mt-2 max-w-xl text-sm text-ink/60">
            Tell us what you&rsquo;re planning and we&rsquo;ll send your request to this
            business.
          </p>
          {inquiryUrl ? (
            <a
              href={inquiryUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-block rounded-full bg-findmi px-6 py-3 text-sm font-bold uppercase tracking-wide text-ink transition hover:bg-findmi-600"
            >
              Request Availability
            </a>
          ) : (
            <p className="mt-4 text-sm text-ink/50">Inquiries aren&rsquo;t open yet.</p>
          )}
          <p className="mt-3 max-w-xl text-xs text-ink/45">
            If this business is unavailable, FindMi can help match you with similar
            businesses — only if you opt in on the request form.
          </p>

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

        {/* I. Follow */}
        <section id="follow" className="mt-12 mb-16 scroll-mt-20">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink">
            Follow Their Moves
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

function SocialGlyph({ icon }: { icon: "link" | "instagram" }) {
  if (icon === "instagram") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
        <rect x="3.5" y="3.5" width="17" height="17" rx="5" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="17" cy="7" r="1" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <path
        d="M9 15l6-6M11 6.5l1.5-1.5a3.2 3.2 0 014.5 4.5L15.5 11M13 17.5L11.5 19a3.2 3.2 0 01-4.5-4.5L8.5 13"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
