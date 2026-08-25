import { CheckboxField, TextareaField, TextField } from "@/components/admin/Fields";
import { getAdminSiteSections } from "@/lib/admin/site-queries";
import {
  JOIN_CARD_DEFAULTS,
  JOIN_CARD_KEYS,
  JOIN_GLOBAL_DEFAULTS,
  JOIN_HERO_DEFAULTS,
  JOIN_WHAT_YOU_GET_DEFAULTS,
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
        Edit the copy, pricing, feature lists, and CTAs on the public{" "}
        <a href="/join" target="_blank" rel="noreferrer" className="font-medium text-findmi-700 hover:underline">
          /join
        </a>{" "}
        page — no code change needed. Blank fields keep FindMi&rsquo;s current default copy.
      </p>
      {error && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved &ldquo;{SAVED_LABELS[saved] ?? saved}&rdquo;.
        </p>
      )}

      <p className="mt-6 text-xs font-bold uppercase tracking-wide text-ink/40">Hero</p>
      <form action={saveJoinHero} className="mt-2 flex flex-col gap-3 rounded-2xl border border-black/10 bg-white p-4">
        <TextField label="Headline" name="heading" defaultValue={hero.heading} placeholder={JOIN_HERO_DEFAULTS.heading} />
        <TextareaField
          label="Supporting text"
          name="body"
          defaultValue={hero.body}
          rows={2}
          hint={`Default: "${JOIN_HERO_DEFAULTS.body}"`}
        />
        <SaveButton />
      </form>

      <p className="mt-6 text-xs font-bold uppercase tracking-wide text-ink/40">Global Join settings</p>
      <form
        action={saveJoinGlobal}
        className="mt-2 flex flex-col gap-3 rounded-2xl border border-black/10 bg-white p-4"
      >
        <TextField
          label="Default form URL"
          name="cta_url"
          type="url"
          defaultValue={global.ctaUrl}
          placeholder={JOIN_GLOBAL_DEFAULTS.ctaUrl}
          hint="Every card's CTA links here unless that card sets its own URL override below."
        />
        <TextareaField
          label={'"No payment today" message'}
          name="message"
          defaultValue={global.message}
          rows={2}
          hint={`Default: "${JOIN_GLOBAL_DEFAULTS.message}"`}
        />
        <TextareaField
          label="Supporting text beneath it (optional)"
          name="supporting_text"
          defaultValue={global.supportingText}
          rows={2}
          hint="Leave blank to show nothing extra — not shown by default."
        />
        <SaveButton />
      </form>

      <p className="mt-8 text-xs font-bold uppercase tracking-wide text-ink/40">The three options</p>
      <div className="mt-2 flex flex-col gap-3">
        {JOIN_CARD_KEYS.map((key) => (
          <JoinCardEditor key={key} cardKey={key} overrides={overrides} globalCtaUrl={global.ctaUrl} />
        ))}
      </div>

      <p className="mt-8 text-xs font-bold uppercase tracking-wide text-ink/40">&ldquo;What you get&rdquo; section</p>
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
          label="Enabled / visible"
          name="is_visible"
          defaultChecked={resolved.visible}
          hint="Turn off to temporarily hide this option from the public page — the other cards reflow to fill the space."
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Eyebrow (small label)" name="eyebrow" defaultValue={row?.eyebrow} placeholder={defaults.eyebrow} />
          <TextField label="Title" name="title" defaultValue={row?.heading} placeholder={defaults.title} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Price text" name="price" defaultValue={resolved.price} placeholder={defaults.price} />
          <TextField
            label="Billing text (optional)"
            name="price_suffix"
            defaultValue={resolved.priceSuffix}
            placeholder={defaults.priceSuffix ?? "e.g. /year"}
          />
        </div>

        <TextareaField
          label="Tagline / description"
          name="tagline"
          defaultValue={row?.body}
          rows={2}
          hint={`Default: "${defaults.tagline}"`}
        />

        <TextareaField
          label="Feature bullets"
          name="features"
          defaultValue={resolved.features.join("\n")}
          rows={Math.max(4, resolved.features.length)}
          hint="One feature per line. Add, remove, reword, or reorder lines — no code/JSON needed."
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="CTA label" name="cta_label" defaultValue={row?.cta_label} placeholder={defaults.ctaLabel} />
          <TextField
            label="CTA URL override (optional)"
            name="cta_url"
            type="url"
            defaultValue={row?.cta_url}
            hint="Leave blank to use the global Join form URL."
          />
        </div>

        <CheckboxField
          label="Emphasized (visually strongest card)"
          name="emphasis"
          defaultChecked={resolved.emphasis}
          hint="Discovery Pro is emphasized by default. Only one card should typically be emphasized at a time."
        />

        <SaveButton />
      </form>
    </div>
  );
}

function WhatYouGetEditor({ overrides }: { overrides: Awaited<ReturnType<typeof getAdminSiteSections>> }) {
  const resolved = resolveJoinWhatYouGet(overrides);
  const row = overrides.get("what_you_get");

  return (
    <form
      action={saveJoinWhatYouGet}
      className="mt-2 flex flex-col gap-3 rounded-2xl border border-black/10 bg-white p-4"
    >
      <CheckboxField
        label="Enabled / visible"
        name="is_visible"
        defaultChecked={resolved.visible}
        hint="Turn off to hide the whole section."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Eyebrow" name="eyebrow" defaultValue={row?.eyebrow} placeholder={JOIN_WHAT_YOU_GET_DEFAULTS.eyebrow} />
        <TextField label="Heading" name="heading" defaultValue={row?.heading} placeholder={JOIN_WHAT_YOU_GET_DEFAULTS.heading} />
      </div>
      <TextareaField
        label="Supporting text (optional)"
        name="body"
        defaultValue={row?.body}
        rows={2}
        hint="Leave blank to show nothing extra — not shown by default."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="CTA label" name="cta_label" defaultValue={row?.cta_label} placeholder={JOIN_WHAT_YOU_GET_DEFAULTS.ctaLabel} />
        <TextField
          label="CTA / profile URL"
          name="cta_url"
          defaultValue={row?.cta_url}
          placeholder={JOIN_WHAT_YOU_GET_DEFAULTS.ctaUrl}
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
