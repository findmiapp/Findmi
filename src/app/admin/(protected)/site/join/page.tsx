import AdminTabNav, { type TabNavItem } from "@/components/admin/TabNav";
import { CheckboxField, TextareaField, TextField } from "@/components/admin/Fields";
import { getAdminSiteSections } from "@/lib/admin/site-queries";
import {
  JOIN_CARD_DEFAULTS,
  JOIN_CARD_KEYS,
  resolveJoinCard,
  resolveJoinClaimBusiness,
  resolveJoinFreeCard,
  resolveJoinGlobal,
  resolveJoinHero,
  resolveJoinInviteSection,
  resolveJoinMoreWays,
  resolveJoinProExtra,
  resolveJoinReassurance,
  resolveJoinWhatYouGet,
  type JoinCardKey,
} from "@/lib/join-page";
import {
  saveJoinCard,
  saveJoinClaimBusiness,
  saveJoinFreeCard,
  saveJoinGlobal,
  saveJoinHero,
  saveJoinInviteSection,
  saveJoinMoreWays,
  saveJoinProExtra,
  saveJoinReassurance,
  saveJoinWhatYouGet,
  saveJoinWhatYouGetTiles,
} from "./actions";

export const dynamic = "force-dynamic";

// Secondary CMS cards only — Free (a different shape entirely, its own
// tab/form/table row) and Pro (its own tab, split across two forms on the
// same card_discovery_pro row) are handled separately below.
const SECONDARY_CARD_KEYS = JOIN_CARD_KEYS.filter((k) => k !== "card_discovery_pro");

const TABS: TabNavItem[] = [
  { key: "hero", label: "Hero" },
  { key: "free", label: "Free Plan" },
  { key: "pro", label: "Pro Plan" },
  { key: "invite", label: "Invite" },
  { key: "additional", label: "Additional Sections" },
  { key: "final", label: "Final CTA" },
];

const SAVED_LABELS: Record<string, string> = {
  hero: "Hero",
  global: "Global Join settings",
  what_you_get: "What you get",
  what_you_get_tiles: "What you get — preview tiles",
  card_free: "Free Plan",
  card_discovery_pro_extra: "Pro Plan — additional presentation",
  invite_section: "Invite section",
  claim_business: "“Already listed” line",
  reassurance_top: "Top reassurance line",
  more_ways: "“More ways to join” heading",
  ...Object.fromEntries(JOIN_CARD_KEYS.map((key) => [key, JOIN_CARD_DEFAULTS[key].label])),
};

// Admin Join Page Editor pass — refactored from one long scrolling page
// into compact tabs (Hero / Free Plan / Pro Plan / Invite / Additional
// Sections / Final CTA), each with its own section-specific save forms —
// saving one section's form never touches another section's row (or, for
// the two rows shared by more than one form — card_discovery_pro,
// what_you_get — never touches the other form's OWN config_json keys on
// that row either; see actions.ts's mergeConfigJson). True drag-reorder
// of these sections was judged impractical for this one page (see this
// pass's own report) — each section still gets its own visible/hidden
// toggle where that's meaningful, just not a page-builder-style reorder
// control, per this pass's explicit "don't build a generic page builder"
// instruction.
export default async function JoinSiteEditorPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; saved?: string; error?: string }>;
}) {
  const { tab: tabParam, saved, error } = await searchParams;
  const tab = TABS.some((t) => t.key === tabParam) ? tabParam! : "hero";
  const overrides = await getAdminSiteSections("join");

  const hero = resolveJoinHero(overrides);
  const global = resolveJoinGlobal(overrides);
  const free = resolveJoinFreeCard(overrides);
  const proExtra = resolveJoinProExtra(overrides);
  const invite = resolveJoinInviteSection(overrides);
  const claim = resolveJoinClaimBusiness(overrides);
  const reassurance = resolveJoinReassurance(overrides);
  const moreWays = resolveJoinMoreWays(overrides);
  const whatYouGet = resolveJoinWhatYouGet(overrides);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Join Page</h1>
      <p className="mt-1 text-sm text-ink/50">
        Edit everything shown on the public{" "}
        <a href="/join" target="_blank" rel="noreferrer" className="font-medium text-findmi-700 hover:underline">
          /join
        </a>{" "}
        page — changes go live within a minute, no code change or deploy needed. Every field already shows what&rsquo;s
        currently live; clear a field back to empty and save to reset just that field to FindMi&rsquo;s default.
      </p>
      <p className="mt-1 text-sm text-ink/50">
        Nothing here changes how Free/Pro actually work — pricing text is display copy only; the real $99 Pro charge,
        365-day access period, Pro Invite validation, and referral discounts are all controlled by the app itself, not
        by anything typed on this page.
      </p>
      {error && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved &ldquo;{SAVED_LABELS[saved] ?? saved}&rdquo;.
        </p>
      )}

      <div className="mt-4">
        <AdminTabNav items={TABS} activeKey={tab} basePath="/admin/site/join" />
      </div>

      {tab === "hero" && (
        <div className="mt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Hero</p>
          <p className="mt-1 text-xs text-ink/45">The big headline and short intro line at the very top of the page.</p>
          <form action={saveJoinHero} className="mt-2 flex flex-col gap-3 rounded-2xl border border-black/10 bg-white p-4">
            <TextField label="Headline" name="heading" defaultValue={hero.heading} />
            <TextareaField label="Supporting text" name="body" defaultValue={hero.body} rows={2} />
            <SaveButton />
          </form>
        </div>
      )}

      {tab === "free" && (
        <div className="mt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Free Plan</p>
          <p className="mt-1 text-xs text-ink/45">
            The quiet, always-available Free option — a plan display box, not a Stripe/plan-tier-backed CMS card.
          </p>
          <FreeCardEditor free={free} />
        </div>
      )}

      {tab === "pro" && (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Pro Plan</p>
          <p className="text-xs text-ink/45">
            The $99/year FindMi Pro card. The button always leads to the real native signup flow (and preserves any
            referral code) no matter what&rsquo;s typed below — only its label text is editable.
          </p>
          <JoinCardEditor cardKey="card_discovery_pro" overrides={overrides} globalCtaUrl={global.ctaUrl} hideCtaUrl />
          <ProExtraEditor proExtra={proExtra} />
        </div>
      )}

      {tab === "invite" && (
        <div className="mt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Pro Invite</p>
          <p className="mt-1 text-xs text-ink/45">
            The manual invite-code entry box shown between the Pro card and the rest of the page. The actual code
            validation/redemption is unaffected by anything here — only this box&rsquo;s heading, helper text, and
            visibility are editable. FindMi doesn&rsquo;t currently show any separate referral-specific copy on
            /join (a referral code is only ever carried silently through the Free/Pro buttons), so there&rsquo;s
            nothing referral-specific to edit here yet.
          </p>
          <InviteSectionEditor invite={invite} />
        </div>
      )}

      {tab === "additional" && (
        <div className="mt-4 flex flex-col gap-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Top reassurance line</p>
            <p className="mt-1 text-xs text-ink/45">The small line shown above the Free/Pro cards.</p>
            <ReassuranceEditor reassurance={reassurance} />
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">&ldquo;Already listed?&rdquo; line</p>
            <p className="mt-1 text-xs text-ink/45">
              The quiet text link under the invite box, for a business that already has a FindMi profile.
            </p>
            <ClaimBusinessEditor claim={claim} />
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Other options (secondary cards)</p>
            <p className="mt-1 text-xs text-ink/45">
              Each card below is an additional option shown further down the page when enabled. Hiding a card
              removes it from the public page entirely.
            </p>
            <div className="mt-2 flex flex-col gap-3">
              {SECONDARY_CARD_KEYS.map((key) => (
                <JoinCardEditor key={key} cardKey={key} overrides={overrides} globalCtaUrl={global.ctaUrl} />
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">
              &ldquo;More ways to join&rdquo; heading
            </p>
            <p className="mt-1 text-xs text-ink/45">
              Shown above the secondary cards above, only when at least one of them is visible.
            </p>
            <MoreWaysEditor moreWays={moreWays} />
          </div>
        </div>
      )}

      {tab === "final" && (
        <div className="mt-4 flex flex-col gap-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Global Join settings</p>
            <p className="mt-1 text-xs text-ink/45">
              Applies across the secondary cards — the shared lead-capture form link and the payment-disclaimer text
              shown near the bottom of the options section.
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
                hint="Where the secondary cards' buttons send people, unless a card is given its own URL override. Must be a full link starting with https://."
              />
              <TextareaField
                label={'"No payment today" message'}
                name="message"
                defaultValue={global.message}
                rows={2}
                hint="The reassurance line shown centered near the bottom of the options section."
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
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">&ldquo;What you get&rdquo; section</p>
            <p className="mt-1 text-xs text-ink/45">
              The section further down the page that previews a real FindMi profile, below the cards.
            </p>
            <WhatYouGetEditor overrides={overrides} />
            <div className="mt-3">
              <WhatYouGetTilesEditor whatYouGet={whatYouGet} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function JoinCardEditor({
  cardKey,
  overrides,
  globalCtaUrl,
  hideCtaUrl,
}: {
  cardKey: JoinCardKey;
  overrides: Awaited<ReturnType<typeof getAdminSiteSections>>;
  globalCtaUrl: string;
  /** Pro's button always routes through the fixed native signup flow (see
   * join/page.tsx's PRO_NATIVE_CTA_URL) — showing a URL override field for
   * it would be misleading since it's never actually used. */
  hideCtaUrl?: boolean;
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
            hint={'The big price shown on the card, e.g. "$99" or "Custom". Display text only — never the actual charged amount.'}
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
          hint="One item per line — each line becomes one checked bullet on the card. Reorder lines to reorder bullets. Leave the whole box blank to reset to FindMi's default list."
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Button text" name="cta_label" defaultValue={resolved.ctaLabel} />
          {!hideCtaUrl && (
            <TextField
              label="Button link override (optional)"
              name="cta_url"
              type="url"
              defaultValue={row?.cta_url ?? ""}
              hint={`Leave blank to use the global Join form URL (currently ${globalCtaUrl}). Only fill this in if this specific card should go somewhere different.`}
            />
          )}
        </div>

        <CheckboxField
          label="Give this card the strongest visual emphasis"
          name="emphasis"
          defaultChecked={resolved.emphasis}
          hint="The emphasized card gets an aqua border, a soft shadow, and a solid aqua button (the others get a plain outline button)."
        />

        <SaveButton />
      </form>
    </div>
  );
}

function ProExtraEditor({ proExtra }: { proExtra: ReturnType<typeof resolveJoinProExtra> }) {
  return (
    <form action={saveJoinProExtra} className="rounded-2xl border border-black/10 bg-white p-4">
      <p className="text-sm font-semibold text-ink">Additional Pro presentation</p>
      <p className="mt-1 text-xs text-ink/45">
        The rest of the Pro card&rsquo;s copy — saving this never touches the title/price/description/features above,
        and saving those never touches this.
      </p>
      <div className="mt-3 flex flex-col gap-3">
        <TextField
          label="Billing/supporting label"
          name="billing_label"
          defaultValue={proExtra.billingLabel}
          hint="Small line directly under the card title, above the price."
        />
        <TextField
          label="Supporting note under the price"
          name="no_renewal_note"
          defaultValue={proExtra.noRenewalNote}
        />
        <p className="text-xs font-bold uppercase tracking-wide text-ink/35">FindMi Here highlight block</p>
        <TextField label="Highlight heading" name="highlight_heading" defaultValue={proExtra.highlightHeading} />
        <TextField label="Highlight subheading" name="highlight_subheading" defaultValue={proExtra.highlightSubheading} />
        <TextareaField label="Highlight body" name="highlight_body" defaultValue={proExtra.highlightBody} rows={2} />
        <TextField
          label="Price reassurance line (under the button)"
          name="price_footnote"
          defaultValue={proExtra.priceFootnote}
          hint="Display copy only — changing this text never changes the actual amount charged at checkout."
        />
        <SaveButton />
      </div>
    </form>
  );
}

function FreeCardEditor({ free }: { free: ReturnType<typeof resolveJoinFreeCard> }) {
  return (
    <form
      action={saveJoinFreeCard}
      className="mt-2 flex flex-col gap-3 rounded-2xl border border-black/10 bg-white p-4"
    >
      <CheckboxField
        label="Show the Free plan card on the public page"
        name="is_visible"
        defaultChecked={free.visible}
        hint="Uncheck to hide this box entirely. This is presentation only — it doesn't disable free business creation elsewhere on the site."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Plan name" name="title" defaultValue={free.title} />
        <TextField label="Price display text" name="price" defaultValue={free.price} hint="Display text only." />
      </div>
      <TextField label="Short tagline (bold line)" name="short_tagline" defaultValue={free.shortTagline} />
      <TextareaField label="Description" name="description" defaultValue={free.description} rows={2} />
      <TextField
        label="“View what's included” disclosure label"
        name="disclosure_label"
        defaultValue={free.disclosureLabel}
      />
      <TextareaField
        label="Included features"
        name="included_features"
        defaultValue={free.includedFeatures.join("\n")}
        rows={Math.max(4, free.includedFeatures.length)}
        hint="One item per line. Reorder lines to reorder bullets. Leave blank to reset to FindMi's default list."
      />
      <TextareaField
        label="Requires Pro (shown muted/struck-through)"
        name="requires_pro_features"
        defaultValue={free.requiresProFeatures.join("\n")}
        rows={Math.max(4, free.requiresProFeatures.length)}
        hint="One item per line. Leave blank to reset to FindMi's default list."
      />
      <TextField label="Button text" name="cta_label" defaultValue={free.ctaLabel} />
      <SaveButton />
    </form>
  );
}

function InviteSectionEditor({ invite }: { invite: ReturnType<typeof resolveJoinInviteSection> }) {
  return (
    <form
      action={saveJoinInviteSection}
      className="mt-2 flex flex-col gap-3 rounded-2xl border border-black/10 bg-white p-4"
    >
      <CheckboxField
        label="Show the invite-code box on the public page"
        name="is_visible"
        defaultChecked={invite.visible}
        hint="Uncheck to hide this box. The findmi.app/join?invite=CODE link still works either way — this only controls the manual entry box."
      />
      <TextField label="Heading" name="heading" defaultValue={invite.heading} />
      <TextareaField
        label="Helper text (optional)"
        name="helper_text"
        defaultValue={invite.helperText ?? ""}
        rows={2}
        hint="An extra line under the heading. Leave blank to show nothing extra here — nothing appears by default."
      />
      <SaveButton />
    </form>
  );
}

function ReassuranceEditor({ reassurance }: { reassurance: ReturnType<typeof resolveJoinReassurance> }) {
  return (
    <form
      action={saveJoinReassurance}
      className="mt-2 flex flex-col gap-3 rounded-2xl border border-black/10 bg-white p-4"
    >
      <CheckboxField label="Show this line" name="is_visible" defaultChecked={reassurance.visible} />
      <TextField label="Text" name="text" defaultValue={reassurance.text} />
      <SaveButton />
    </form>
  );
}

function ClaimBusinessEditor({ claim }: { claim: ReturnType<typeof resolveJoinClaimBusiness> }) {
  return (
    <form
      action={saveJoinClaimBusiness}
      className="mt-2 flex flex-col gap-3 rounded-2xl border border-black/10 bg-white p-4"
    >
      <CheckboxField label="Show this line" name="is_visible" defaultChecked={claim.visible} />
      <TextField label="Text before the link" name="body" defaultValue={claim.body} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Link text" name="cta_label" defaultValue={claim.ctaLabel} />
        <TextField
          label="Link destination"
          name="cta_url"
          defaultValue={claim.ctaUrl}
          hint="A page on FindMi (e.g. /businesses) or a full https:// URL."
        />
      </div>
      <SaveButton />
    </form>
  );
}

function MoreWaysEditor({ moreWays }: { moreWays: ReturnType<typeof resolveJoinMoreWays> }) {
  return (
    <form
      action={saveJoinMoreWays}
      className="mt-2 flex flex-col gap-3 rounded-2xl border border-black/10 bg-white p-4"
    >
      <TextField label="Heading" name="heading" defaultValue={moreWays.heading} />
      <SaveButton />
    </form>
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

function WhatYouGetTilesEditor({ whatYouGet }: { whatYouGet: ReturnType<typeof resolveJoinWhatYouGet> }) {
  return (
    <form
      action={saveJoinWhatYouGetTiles}
      className="flex flex-col gap-3 rounded-2xl border border-black/10 bg-white p-4"
    >
      <p className="text-sm font-semibold text-ink">Preview tiles</p>
      <p className="text-xs text-ink/45">
        The four small tiles in a grid under the heading above. Leave every field below blank to reset all four to
        FindMi&rsquo;s default tiles.
      </p>
      {whatYouGet.tiles.map((tile, i) => (
        <div key={i} className="grid gap-3 rounded-xl border border-black/5 p-3 sm:grid-cols-2">
          <TextField label={`Tile ${i + 1} label`} name={`tile_${i + 1}_label`} defaultValue={tile.label} />
          <TextField label={`Tile ${i + 1} detail`} name={`tile_${i + 1}_detail`} defaultValue={tile.detail} />
        </div>
      ))}
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
