import type { Metadata } from "next";
import Link from "next/link";
import { getSiteSections } from "@/lib/site-sections";
import { resolveAboutHero, resolveAboutContact } from "@/lib/about-page";
import { getSiteContactInfo } from "@/lib/contact-info";

export const metadata: Metadata = {
  title: "About",
  description: "Findmi connects what you discover online with where you can experience it in the real world.",
};

// Menu Polish + Editable About pass — server-rendered from the founder-
// editable site_sections "about" page (see lib/about-page.ts), same
// pattern as every other public page that reads site_sections (no
// client-side fetch/loading state). A missing/unconfigured row renders
// the exact same copy this page always had — see about-page.ts's
// defaults. Contact section's actual email comes from the existing
// global Contact Info setting (getSiteContactInfo) rather than a
// duplicate About-specific email field, and is hidden entirely when no
// email is configured — never a fabricated address or a dead mailto:.
const primaryCtaClass =
  "flex h-12 w-full items-center sm:w-auto sm:flex-1 sm:items-center justify-center rounded-xl bg-findmi px-5 text-center text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600";
const secondaryCtaClass =
  "flex h-12 w-full items-center sm:w-auto sm:flex-1 sm:items-center justify-center rounded-xl border border-black/10 px-5 text-center text-sm font-bold uppercase tracking-wide text-ink transition hover:border-ink/30";

// Fixed About content (Legal content pass, Oct 2026): what Findmi does for
// people and for businesses today. Not founder-editable on purpose: it
// describes the product's actual capabilities.
const ABOUT_AUDIENCES = [
  {
    id: "about-people",
    title: "For People",
    points: [
      "Discover brands, businesses, places, products and Events near you",
      "See where a business will be next, and what's happening Here Now",
      "Follow and save what you love, and organize it your way",
      "Share Moments from the places and experiences you find",
    ],
  },
  {
    id: "about-businesses",
    title: "For Businesses",
    points: [
      "One connected presence for your brand, products, locations, Events and Appearances",
      "Publish where you'll be, so customers can find you",
      "Use Findmi's business tools, including products, Opportunities and messaging",
      "Connect with customers, venues, organizers and other businesses",
    ],
  },
] as const;

export default async function AboutPage() {
  const overrides = await getSiteSections("about");
  const hero = resolveAboutHero(overrides);
  const contact = resolveAboutContact(overrides);
  const contactInfo = await getSiteContactInfo();
  const showContact = contact.visible && Boolean(contactInfo.email);

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
      {hero.eyebrow && (
        <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">{hero.eyebrow}</p>
      )}
      <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">{hero.heading}</h1>
      <p className="mt-6 text-base leading-relaxed text-ink/70">{hero.intro}</p>
      <p className="mt-4 text-base font-medium leading-relaxed text-ink">&ldquo;{hero.highlight}&rdquo;</p>
      {hero.bodyParagraphs.map((paragraph, i) => (
        <p key={i} className="mt-4 whitespace-pre-line text-base leading-relaxed text-ink/70">
          {paragraph}
        </p>
      ))}

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {ABOUT_AUDIENCES.map((a) => (
          <section key={a.title} aria-labelledby={a.id} className="rounded-2xl border border-black/5 bg-white p-5">
            <h2 id={a.id} className="font-display text-lg font-semibold tracking-tight text-ink">
              {a.title}
            </h2>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink/70">
              {a.points.map((p) => (
                <li key={p} className="flex gap-2">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-findmi" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section aria-labelledby="about-pages" className="mt-10">
        <h2 id="about-pages" className="font-display text-lg font-semibold tracking-tight text-ink">
          About The Pages On Findmi
        </h2>
        <p className="mt-2 text-base leading-relaxed text-ink/70">
          Some pages are managed by the business or organization itself. Others were compiled by Findmi from publicly available information or added
          by people who use Findmi, so the business can claim them later. Each page&rsquo;s About This Page section shows which kind it is. Anyone
          can suggest a correction, request removal or report a page, for free.
        </p>
      </section>

      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <Link href={hero.ctaUrl} className={primaryCtaClass}>
          {hero.ctaLabel}
        </Link>
        <Link href={hero.secondaryCtaUrl} className={secondaryCtaClass}>
          {hero.secondaryCtaLabel}
        </Link>
      </div>

      <p className="mt-8 text-sm text-ink/55">
        Findmi&rsquo;s{" "}
        <Link href="/terms" className="font-medium text-ink/75 underline underline-offset-2 hover:text-ink">
          Terms of Service
        </Link>
        ,{" "}
        <Link href="/privacy" className="font-medium text-ink/75 underline underline-offset-2 hover:text-ink">
          Privacy Policy
        </Link>{" "}
        and{" "}
        <Link href="/privacy-choices" className="font-medium text-ink/75 underline underline-offset-2 hover:text-ink">
          Privacy Choices
        </Link>{" "}
        explain how Findmi works with you.
      </p>

      {showContact && (
        <div className="mt-14 rounded-2xl border border-black/10 bg-black/[0.015] p-6">
          <h2 className="font-display text-lg font-semibold tracking-tight text-ink">{contact.heading}</h2>
          {contact.body && <p className="mt-2 text-sm leading-relaxed text-ink/60">{contact.body}</p>}
          <a
            href={`mailto:${contactInfo.email}`}
            className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-findmi px-5 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          >
            {contact.ctaLabel}
          </a>
        </div>
      )}
    </div>
  );
}
