import type { Metadata } from "next";
import Link from "next/link";
import { getSiteSections } from "@/lib/site-sections";
import { resolveAboutHero, resolveAboutContact } from "@/lib/about-page";
import { getSiteContactInfo } from "@/lib/contact-info";

export const metadata: Metadata = {
  title: "About",
  description: "Findmi helps you discover businesses and always know where to find them next.",
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
  "flex h-12 flex-1 items-center justify-center rounded-xl bg-findmi px-5 text-center text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600";
const secondaryCtaClass =
  "flex h-12 flex-1 items-center justify-center rounded-xl border border-black/10 px-5 text-center text-sm font-bold uppercase tracking-wide text-ink transition hover:border-ink/30";

export default async function AboutPage() {
  const overrides = await getSiteSections("about");
  const hero = resolveAboutHero(overrides);
  const contact = resolveAboutContact(overrides);
  const contactInfo = await getSiteContactInfo();
  const showContact = contact.visible && Boolean(contactInfo.email);

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
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

      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <Link href={hero.ctaUrl} className={primaryCtaClass}>
          {hero.ctaLabel}
        </Link>
        <Link href={hero.secondaryCtaUrl} className={secondaryCtaClass}>
          {hero.secondaryCtaLabel}
        </Link>
      </div>

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
