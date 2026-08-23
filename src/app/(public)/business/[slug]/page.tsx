import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import AppearanceCard from "@/components/AppearanceCard";
import BusinessCard from "@/components/BusinessCard";
import ProductCard from "@/components/ProductCard";
import PersonCard from "@/components/PersonCard";
import FollowButton from "@/components/FollowButton";
import SaveButton from "@/components/SaveButton";
import { CategoryPill, VerifiedBadge } from "@/components/Badge";
import {
  getAlternativeBusinesses,
  getBusinessBySlug,
  getPeopleForBusiness,
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

  const [products, appearances, alternatives, people] = await Promise.all([
    getProductsForBusiness(business.id),
    getUpcomingAppearancesForBusiness(business.id),
    getAlternativeBusinesses(business),
    getPeopleForBusiness(business.id),
  ]);

  // "Meet the Owners" only when every configured role genuinely says so —
  // never assumed. Any broader/mixed set of roles gets the honest generic
  // heading instead.
  const allOwnersOrFounders =
    people.length > 0 && people.every((p) => /owner|founder/i.test(p.role ?? ""));
  const peopleHeading = allOwnersOrFounders ? "Meet the Owners" : `Meet the People Behind ${business.name}`;

  const gallery = Array.from(
    new Set(
      [business.cover_image_url, ...products.map((p) => p.image_url)].filter(
        (v): v is string => Boolean(v)
      )
    )
  ).slice(0, 8);

  const inquiryUrl = getInquiryFormUrl(business);
  // If the global Tally inquiry form isn't configured, fall back to a real
  // mailto to this specific business — only when it actually has an email
  // on file. Never fabricated; a business with neither still correctly
  // shows "Inquiries aren't open yet."
  const inquiryHref =
    inquiryUrl ||
    (business.email
      ? `mailto:${business.email}?subject=${encodeURIComponent(`Inquiry via FindMi — ${business.name}`)}`
      : null);
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

      <div className="mx-auto max-w-4xl px-6 pb-12">
        {/* B. Business identity */}
        {business.logo_url && (
          <div className="-mt-12 flex flex-col gap-4 sm:-mt-14 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-end gap-4">
              <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl border-4 border-paper bg-white shadow-sm sm:h-28 sm:w-28">
                <Image
                  src={business.logo_url}
                  alt={business.name}
                  fill
                  sizes="112px"
                  className="object-cover"
                />
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
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

          {/* C. Primary action — Follow — plus restrained utility controls */}
          <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
            <FollowButton businessId={business.id} businessSlug={business.slug} />
            <SaveButton slug={business.slug} />
            {socialLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                aria-label={link.label}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/10 text-ink/70 transition hover:border-ink/30 hover:text-ink"
              >
                <SocialGlyph icon={link.icon} />
              </a>
            ))}
          </div>
        </div>

        {/* D. FindMi Here — the signature feature. Always present, even with
            nothing scheduled, so the concept stays visible on every profile.
            Plain surface, not a full pale-aqua panel — Aqua stays in the
            kicker label and the compact per-row action only. */}
        <section className="mt-8">
          <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">
            FindMi Here
          </p>
          <h2 className="mt-1 font-display text-lg font-semibold tracking-tight text-ink">
            Find {business.name}
          </h2>
          {appearances.length > 0 ? (
            <div className="mt-3 flex flex-col gap-2">
              {appearances.slice(0, 3).map((a) => (
                <AppearanceCard key={a.id} appearance={a} eventSlug={a.event?.slug} />
              ))}
              {appearances.length > 3 && (
                <details className="group">
                  <summary className="flex list-none items-center justify-center gap-1 rounded-full border border-black/10 py-2 text-center text-xs font-bold uppercase tracking-wide text-findmi-700 [&::-webkit-details-marker]:hidden">
                    View All Appearances
                    <span className="transition group-open:hidden">→</span>
                  </summary>
                  <div className="mt-2 flex flex-col gap-2">
                    {appearances.slice(3).map((a) => (
                      <AppearanceCard key={a.id} appearance={a} eventSlug={a.event?.slug} />
                    ))}
                  </div>
                </details>
              )}
            </div>
          ) : (
            <div className="mt-3 rounded-2xl border border-black/5 bg-black/[0.02] p-4">
              <p className="text-sm text-ink/60">
                Nothing announced yet. Follow and we&rsquo;ll let you know where to find them
                next.
              </p>
              <div className="mt-3">
                <FollowButton businessId={business.id} businessSlug={business.slug} />
              </div>
            </div>
          )}
        </section>

        {/* E. What You'll Find */}
        {products.length > 0 && (
          <section className="mt-8">
            <h2 className="font-display text-lg font-semibold tracking-tight text-ink">
              What You&rsquo;ll Find
            </h2>
            {/* Mobile: horizontal swipe carousel, fixed-width cards and a
                hidden scrollbar — the same bleed-to-gutter + hide-scrollbar
                technique used by every other carousel in the app (see
                components/Section.tsx's HorizontalScroller), sized to this
                page's own px-6 gutter rather than reusing that component's
                own (different) padding. Desktop: a plain grid. */}
            <div className="mt-4 -mx-6 flex gap-4 overflow-x-auto px-6 pb-1 sm:mx-0 sm:grid sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 sm:grid-cols-3 md:grid-cols-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {products.map((p) => (
                <div key={p.id} className="w-40 shrink-0 sm:w-auto sm:shrink">
                  <ProductCard product={p} />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* F. About */}
        {business.description && (
          <section className="mt-8">
            <h2 className="font-display text-lg font-semibold tracking-tight text-ink">About</h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink/70">
              {business.description}
            </p>
          </section>
        )}

        {/* F2. People — editorial, human; single person gets a stronger
            treatment, multiple people use a horizontal carousel. Never
            rendered empty. */}
        {people.length > 0 && (
          <section className="mt-8">
            <h2 className="font-display text-lg font-semibold tracking-tight text-ink">{peopleHeading}</h2>
            {people.length === 1 ? (
              <div className="mt-4 max-w-xs">
                <PersonCard person={people[0]} role={people[0].role} />
              </div>
            ) : (
              <div className="mt-4 -mx-6 flex gap-4 overflow-x-auto px-6 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {people.map((p) => (
                  <div key={p.id} className="w-40 shrink-0">
                    <PersonCard person={p} role={p.role} />
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* G. Gallery */}
        {gallery.length > 0 && (
          <section className="mt-8">
            <h2 className="font-display text-lg font-semibold tracking-tight text-ink">Gallery</h2>
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
        <section id="book" className="mt-8 scroll-mt-20 rounded-3xl bg-black/[0.03] p-5 sm:p-6">
          <h2 className="font-display text-lg font-semibold tracking-tight text-ink">
            Book / Inquire
          </h2>
          <p className="mt-2 max-w-xl text-sm text-ink/60">
            Tell us what you&rsquo;re planning and we&rsquo;ll send your request to this
            business.
          </p>
          {inquiryHref ? (
            <a
              href={inquiryHref}
              target={inquiryHref.startsWith("mailto:") ? undefined : "_blank"}
              rel="noreferrer"
              className="mt-4 inline-block rounded-full bg-findmi px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
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
            <div className="mt-6 border-t border-black/5 pt-5">
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
