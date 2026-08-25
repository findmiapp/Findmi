import { CheckboxField, TextareaField, TextField } from "@/components/admin/Fields";
import { getAdminSiteSections } from "@/lib/admin/site-queries";
import {
  JOIN_CARD_DEFAULTS,
  JOIN_CARD_KEYS,
  resolveJoinCard,
  resolveJoinGlobal,
  resolveJoinHero,
  resolveJoinWhatYouGet,
  type JoinCardKey,
} from "@/lib/join-page";
import { saveJoinCard, saveJoinGlobal, saveJoinHero, saveJoinWhatYouGet } from "./actions";

export const dynamic = "force-dynamic";

const SAVED_LABELS: Record<string, string> = {
  hero: "Hero",
  global: "Global Join settings",
  what_you_get: "What you get",
  ...Object.fromEntries(JOIN_CARD_KEYS.map((key) => [key, JOIN_CARD_DEFAULTS[key].label])),
};

// Shown once at the top of the page — every field below follows the same
// rule, so it only needs saying once, not repeated per field.
const FALLBACK_NOTE =
  "Every field already shows what's currently live (FindMi's default copy, until you've saved something different). Clear a field back to empty and save to reset just that field to FindMi's default.";

export default async function JoinSiteEditorPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const overrides = await getAdminSiteSections("join");

  const hero = resolveJoinHero(overrides);
  const global = resolveJoinGlobal(overrides);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Join Page</h1>
      <p className="mt-1 text-sm text-ink/50">
        Edit the headline, pricing, feature lists, and buttons on the public{" "}
        <a href="/join" target="_blank" rel="noreferrer" className="font-medium text-findmi-700 hover:underline">
          /join
        </a>{" "}
        page — changes go live within a minute, no code change or deploy needed.
      </p>
      <p className="mt-1 text-sm text-ink/50">{FALLBACK_NOTE}</p>
      {error && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved &ldquo;{SAVED_LABELS[saved] ?? saved}&rdquo;.
        </p>
      )}

      <p className="mt-6 text-xs font-bold uppercase tracking-wide text-ink/40">Hero</p>
      <p className="mt-1 text-xs text-ink/45">The big headline and short intro line at the very top of the page.</p>
      <form action={saveJoinHero} className="mt-2 flex flex-col gap-3 rounded-2xl border border-black/10 bg-white p-4">
        <TextField label="Headline" name="heading" defaultValue={hero.heading} />
        <TextareaField label="Supporting text" name="body" defaultValue={hero.body} rows={2} />
        <SaveButton />
      </form>

      <p className="mt-8 text-xs font-bold uppercase tracking-wide text-ink/40">Global Join settings</p>
      <p className="mt-1 text-xs text-ink/45">
        Applies across all three options below — the shared lead-capture form link and the payment-disclaimer
        text shown under the cards.
      </p>
      <form
        action={saveJoinGlobal}
        className="mt-2 flex flex-col gap-3 rounded-2xl border border-black/10 bg-white p-4"
      >
        <TextField
          label="Default Join form URL"
          name="cta_url"
          type="url"
          defaultValue={global.ctaUrl}
          hint="Where all three buttons below send people, unless a card below is given its own URL override. This is the Tally lead-capture form — must be a full link starting with https://."
        />
        <TextareaField
          label={'"No payment today" message'}
          name="message"
          defaultValue={global.message}
          rows={2}
          hint="The reassurance line shown centered under the three cards, making clear this step doesn't charge anyone."
        />
        <TextareaField
          label="Extra line beneath it (optional)"
          name="supporting_text"
          defaultValue={global.supportingText}
          rows={2}
          hint="Leave blank to show nothing extra here — nothing appears by default."
        />
        <SaveButton />
      </form>

      <p className="mt-8 text-xs font-bold uppercase tracking-wide text-ink/40">The three options</p>
      <p className="mt-1 text-xs text-ink/45">
        Each card below is one option a visitor can choose. Hiding a card removes it from the public page
        entirely — the remaining cards resize to fill the space, so there&rsquo;s never a gap.
      </p>
      <div className="mt-2 flex flex-col gap-3">
        {JOIN_CARD_KEYS.map((key) => (
          <JoinCardEditor key={key} cardKey={key} overrides={overrides} globalCtaUrl={global.ctaUrl} />
        ))}
      </div>

      <p className="mt-8 text-xs font-bold uppercase tracking-wide text-ink/40">&ldquo;What you get&rdquo; section</p>
      <p className="mt-1 text-xs text-ink/45">
        The section further down the page that previews a real FindMi profile, below the three cards.
      </p>
      <WhatYouGetEditor overrides={overrides} />
    </div>
  );
}

function JoinCardEditor({
  cardKey,
  overrides,
  globalCtaUrl,
}: {
  cardKey: JoinCardKey;
  overrides: Awaited<ReturnType<typeof getAdminSiteSections>>;
  globalCtaUrl: string;
}) {
  const defaults = JOIN_CARD_DEFAULTS[cardKey];
  const resolved = resolveJoinCard(overrides, cardKey, globalCtaUrl);
  const row = overrides.get(cardKey);
  const action = saveJoinCard.bind(null, cardKey);

  return (
    <div className="rounded-2xl border border-black/10 bg-white p-4">
      <p className="font-display text-sm font-semibold tracking-tight text-ink">{defaults.label}</p>

      <form action={action} className="mt-3 flex flex-col gap-3">
        <CheckboxField
          label="Show this card on the public page"
          name="is_visible"
          defaultChecked={resolved.visible}
          hint="Uncheck to temporarily hide this option — nothing is deleted, and re-checking it later brings back everything you've saved here."
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Small label above the title" name="eyebrow" defaultValue={resolved.eyebrow} />
          <TextField label="Card title" name="title" defaultValue={resolved.title} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Price"
            name="price"
            defaultValue={resolved.price}
            hint={'The big price shown on the card, e.g. "$99" or "Custom".'}
          />
          <TextField
            label="Billing period (optional)"
            name="price_suffix"
            defaultValue={resolved.priceSuffix ?? ""}
            hint={'Smaller text right after the price, e.g. "/year". Leave blank for none.'}
          />
        </div>

        <TextareaField label="Description" name="tagline" defaultValue={resolved.tagline} rows={2} />

        <TextareaField
          label="What's included (feature list)"
          name="features"
          defaultValue={resolved.features.join("\n")}
          rows={Math.max(4, resolved.features.length)}
          hint="One item per line — each line becomes one checked bullet on the card. Add a line, delete a line, edit the wording, or reorder the lines to reorder the bullets. Leave the whole box blank to reset to FindMi's default list."
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Button text" name="cta_label" defaultValue={resolved.ctaLabel} />
          <TextField
            label="Button link override (optional)"
            name="cta_url"
            type="url"
            defaultValue={row?.cta_url ?? ""}
            hint={`Leave blank to use the global Join form URL above (currently ${globalCtaUrl}). Only fill this in if this specific card should go somewhere different.`}
          />
        </div>

        <CheckboxField
          label="Give this card the strongest visual emphasis"
          name="emphasis"
          defaultChecked={resolved.emphasis}
          hint="The emphasized card gets an aqua border, a soft shadow, and a solid aqua button (the others get a plain outline button). Normally only one card should be emphasized at a time — Discovery Pro is emphasized by default."
        />

        <SaveButton />
      </form>
    </div>
  );
}

function WhatYouGetEditor({ overrides }: { overrides: Awaited<ReturnType<typeof getAdminSiteSections>> }) {
  const resolved = resolveJoinWhatYouGet(overrides);

  return (
    <form
      action={saveJoinWhatYouGet}
      className="mt-2 flex flex-col gap-3 rounded-2xl border border-black/10 bg-white p-4"
    >
      <CheckboxField
        label="Show this section on the public page"
        name="is_visible"
        defaultChecked={resolved.visible}
        hint="Uncheck to remove this entire section from the public page."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Small label above the heading" name="eyebrow" defaultValue={resolved.eyebrow} />
        <TextField label="Heading" name="heading" defaultValue={resolved.heading} />
      </div>
      <TextareaField
        label="Supporting text (optional)"
        name="body"
        defaultValue={resolved.body ?? ""}
        rows={2}
        hint="An extra line under the heading. Leave blank to show nothing extra here — nothing appears by default."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Link text" name="cta_label" defaultValue={resolved.ctaLabel} />
        <TextField
          label="Link destination"
          name="cta_url"
          defaultValue={resolved.ctaUrl}
          hint="A page on FindMi (e.g. /business/the-native-rose) or a full https:// URL."
        />
      </div>
      <SaveButton />
    </form>
  );
}

function SaveButton() {
  return (
    <button
      type="submit"
      className="self-start rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
    >
      Save
    </button>
  );
}
