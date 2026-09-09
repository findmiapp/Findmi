import Link from "next/link";
import { TextField, TextareaField, CheckboxField } from "@/components/admin/Fields";
import { getAdminSiteSections } from "@/lib/admin/site-queries";
import { resolveAboutHero, resolveAboutContact } from "@/lib/about-page";
import { getSiteContactInfo } from "@/lib/contact-info";
import { saveAboutHero, saveAboutContact } from "./actions";

export const dynamic = "force-dynamic";

export default async function AboutSiteEditorPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const overrides = await getAdminSiteSections("about");
  const hero = resolveAboutHero(overrides);
  const contact = resolveAboutContact(overrides);
  const contactInfo = await getSiteContactInfo();

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-ink/45">
        <Link href="/admin/site" className="hover:underline">
          Site Editor
        </Link>
        <span>/</span>
        <span>About Page</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">About Page</h1>
        <Link href="/about" target="_blank" className="shrink-0 text-sm font-semibold text-findmi-700 hover:underline">
          View About Page →
        </Link>
      </div>
      <p className="mt-1 max-w-xl text-sm text-ink/50">
        Edit the copy and calls-to-action on the public /about page without a code change.
      </p>

      {error && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved.
        </p>
      )}

      <form action={saveAboutHero} className="mt-6 flex flex-col gap-3 rounded-2xl border border-black/10 bg-white p-4">
        <p className="text-sm font-semibold text-ink">Main Content</p>
        <TextField
          label="Eyebrow (optional)"
          name="eyebrow"
          defaultValue={hero.eyebrow ?? ""}
          placeholder="e.g. Our Story"
          hint="Small label above the heading. Leave blank to hide it."
        />
        <TextField label="Heading" name="heading" defaultValue={hero.heading} required />
        <TextareaField
          label="Intro"
          name="intro"
          defaultValue={hero.intro}
          rows={3}
          hint="The opening line, shown just above the highlighted statement."
        />
        <TextField
          label="Highlighted statement"
          name="highlight"
          defaultValue={hero.highlight}
          hint="Shown as its own emphasized line, e.g. a quoted question."
        />
        <TextareaField
          label="Additional paragraphs"
          name="body_extra"
          defaultValue={hero.bodyParagraphs.join("\n\n")}
          rows={6}
          hint="Leave a blank line between paragraphs to start a new one."
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="Primary button label" name="cta_label" defaultValue={hero.ctaLabel} required />
          <TextField label="Primary button link" name="cta_url" defaultValue={hero.ctaUrl} required />
          <TextField
            label="Secondary button label"
            name="secondary_cta_label"
            defaultValue={hero.secondaryCtaLabel}
            required
          />
          <TextField
            label="Secondary button link"
            name="secondary_cta_url"
            defaultValue={hero.secondaryCtaUrl}
            required
          />
        </div>
        <button
          type="submit"
          className="self-start rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Save
        </button>
      </form>

      <form
        action={saveAboutContact}
        className="mt-4 flex flex-col gap-3 rounded-2xl border border-black/10 bg-white p-4"
      >
        <p className="text-sm font-semibold text-ink">Contact Section</p>
        <p className="text-xs text-ink/45">
          The actual email address comes from{" "}
          <Link href="/admin/site/contact" className="underline">
            Contact Info
          </Link>{" "}
          — currently {contactInfo.email ? <span className="font-medium text-ink">{contactInfo.email}</span> : "not configured"}
          . This section stays hidden on the public page until an email is set there.
        </p>
        <CheckboxField
          label="Show Contact section"
          name="contact_visible"
          defaultChecked={contact.visible}
        />
        <TextField label="Heading" name="contact_heading" defaultValue={contact.heading} required />
        <TextareaField label="Copy" name="contact_body" defaultValue={contact.body} rows={2} />
        <TextField label="Button label" name="contact_cta_label" defaultValue={contact.ctaLabel} required />
        <button
          type="submit"
          className="self-start rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Save
        </button>
      </form>
    </div>
  );
}
