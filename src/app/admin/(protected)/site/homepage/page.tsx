import Link from "next/link";
import { CheckboxField, NumberField, TextField, TextareaField } from "@/components/admin/Fields";
import ImageField from "@/components/admin/ImageField";
import { getAdminSiteSections } from "@/lib/admin/site-queries";
import {
  DEFAULT_DISCOVERY_TOPICS,
  getDiscoveryTopicsRaw,
  HOMEPAGE_ORDERABLE_KEYS,
  HOMEPAGE_SECTIONS,
  resolveSection,
  resolveWeatherConfig,
  type SectionDefaults,
} from "@/lib/site-sections";
import { saveSiteSection, saveDiscoveryTopics, saveWeatherConfig, moveSectionDown, moveSectionUp } from "./actions";

export const dynamic = "force-dynamic";

export default async function HomepageSiteEditorPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const overrides = await getAdminSiteSections("homepage");

  const pinnedKeys = Object.entries(HOMEPAGE_SECTIONS)
    .filter(([, def]) => def.orderable === false)
    .map(([key]) => key);

  // Featured Brands, Shop Local, and the Business Showcase are no longer
  // rendered from site_sections — the public homepage now builds those as
  // Homepage Rows instead (see the link above), so editing these three
  // keys here would silently do nothing. Excluded rather than left as a
  // dead control; no data is deleted, the site_sections rows just stop
  // being read for these keys (page.tsx no longer calls resolveSection on
  // them either).
  const rowDrivenKeys = new Set(["business_doorway", "shop_findmi", "featured_brands"]);
  const orderedKeys = [...HOMEPAGE_ORDERABLE_KEYS]
    .filter((key) => !rowDrivenKeys.has(key))
    .sort(
      (a, b) => resolveSection(overrides, a, HOMEPAGE_SECTIONS[a]).order - resolveSection(overrides, b, HOMEPAGE_SECTIONS[b]).order
    );

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Homepage</h1>
      <p className="mt-1 text-sm text-ink/50">
        Each card edits one homepage section. Blank fields keep FindMi&rsquo;s current default copy —
        you never need to fill in every field.
      </p>
      {error && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved &ldquo;{savedSectionLabel(saved)}&rdquo;.
        </p>
      )}

      <Link
        href="/admin/site/homepage/rows"
        className="mt-5 flex items-center justify-between rounded-2xl border border-findmi/30 bg-findmi-50 px-4 py-3.5 transition hover:border-findmi/50"
      >
        <span>
          <span className="block text-sm font-semibold text-findmi-700">Homepage Rows</span>
          <span className="block text-xs text-ink/50">
            Add, reorder, hide, or delete discovery rows (Businesses, Events, Products, or the Business
            Showcase) — no code change needed.
          </span>
        </span>
        <span className="shrink-0 text-findmi-700">→</span>
      </Link>

      <p className="mt-6 text-xs font-bold uppercase tracking-wide text-ink/40">Masthead — always first</p>
      <div className="mt-2 flex flex-col gap-3">
        {pinnedKeys.map((key) => (
          <SectionCard key={key} sectionKey={key} def={HOMEPAGE_SECTIONS[key]} overrides={overrides} />
        ))}
      </div>

      <p className="mt-8 text-xs font-bold uppercase tracking-wide text-ink/40">
        Weather / Local Context — between Hero and Search
      </p>
      <div className="mt-2 flex flex-col gap-3">
        <WeatherCard overrides={overrides} />
      </div>

      <p className="mt-8 text-xs font-bold uppercase tracking-wide text-ink/40">
        Discovery Topics — shortcut row after Search
      </p>
      <div className="mt-2 flex flex-col gap-3">
        <DiscoveryTopicsCard overrides={overrides} />
      </div>

      <p className="mt-8 text-xs font-bold uppercase tracking-wide text-ink/40">Homepage sections — in order</p>
      <div className="mt-2 flex flex-col gap-3">
        {orderedKeys.map((key, i) => (
          <SectionCard
            key={key}
            sectionKey={key}
            def={HOMEPAGE_SECTIONS[key]}
            overrides={overrides}
            canMoveUp={i > 0}
            canMoveDown={i < orderedKeys.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

function savedSectionLabel(saved: string): string {
  if (saved === "discovery_topics") return "Discovery Topics";
  if (saved === "weather") return "Weather / Local Context";
  return HOMEPAGE_SECTIONS[saved]?.label ?? saved;
}

function WeatherCard({ overrides }: { overrides: Awaited<ReturnType<typeof getAdminSiteSections>> }) {
  const config = resolveWeatherConfig(overrides);

  return (
    <div className="rounded-2xl border border-black/10 bg-white p-4">
      <p className="font-display text-sm font-semibold tracking-tight text-ink">Weather / Local Context</p>
      <p className="mt-1 text-xs text-ink/45">
        The small icon + temperature + city + local date/time strip below the Hero. Weather is looked up
        server-side from this city name — no API keys or coordinates to manage here.
      </p>

      <form action={saveWeatherConfig} className="mt-3 flex flex-col gap-3">
        <TextField
          label="Weather location"
          name="weather_city"
          defaultValue={config.city}
          placeholder="City, State"
          hint="A city name FindMi can look up, e.g. &quot;Staten Island, NY&quot;."
        />
        <CheckboxField label="Show weather" name="weather_show" defaultChecked={config.show} />
        <button
          type="submit"
          className="self-start rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink transition hover:bg-findmi-600"
        >
          Save
        </button>
      </form>
    </div>
  );
}

function DiscoveryTopicsCard({ overrides }: { overrides: Awaited<ReturnType<typeof getAdminSiteSections>> }) {
  const topics = getDiscoveryTopicsRaw(overrides);

  return (
    <div className="rounded-2xl border border-black/10 bg-white p-4">
      <p className="font-display text-sm font-semibold tracking-tight text-ink">Discovery Topics</p>
      <p className="mt-1 text-xs text-ink/45">
        The compact chip row between Search and Upcoming Events. Each topic is a plain link — not a
        cross-content filter. Leave a Destination blank to hide that topic rather than link somewhere broken.
      </p>

      <form action={saveDiscoveryTopics} className="mt-3 flex flex-col gap-3">
        {topics.map((topic, i) => {
          const n = i + 1;
          const def = DEFAULT_DISCOVERY_TOPICS[i];
          return (
            <div key={n} className="rounded-xl border border-black/5 bg-black/[0.015] p-3">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink/40">Topic {n}</p>
              <div className="grid gap-3 sm:grid-cols-[2fr_3fr_1fr]">
                <TextField label="Label" name={`topic_${n}_label`} defaultValue={topic.label} placeholder={def.label} />
                <TextField
                  label="Destination"
                  name={`topic_${n}_url`}
                  defaultValue={topic.url}
                  placeholder={def.url || "/businesses?category=…"}
                  hint="Internal path (/…) or https://"
                />
                <NumberField label="Order" name={`topic_${n}_order`} defaultValue={topic.order} step="1" />
              </div>
              <div className="mt-2">
                <CheckboxField label="Visible" name={`topic_${n}_visible`} defaultChecked={topic.visible} />
              </div>
            </div>
          );
        })}
        <button
          type="submit"
          className="self-start rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink transition hover:bg-findmi-600"
        >
          Save
        </button>
      </form>
    </div>
  );
}

function SectionCard({
  sectionKey,
  def,
  overrides,
  canMoveUp,
  canMoveDown,
}: {
  sectionKey: string;
  def: SectionDefaults;
  overrides: Awaited<ReturnType<typeof getAdminSiteSections>>;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}) {
  const resolved = resolveSection(overrides, sectionKey, def);
  const row = overrides.get(sectionKey);
  const action = saveSiteSection.bind(null, sectionKey);
  const showMoveControls = canMoveUp !== undefined;

  return (
    <div className="rounded-2xl border border-black/10 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-display text-sm font-semibold tracking-tight text-ink">{def.label}</p>
        {showMoveControls && (
          <div className="flex shrink-0 gap-1.5">
            <form action={moveSectionUp.bind(null, sectionKey)}>
              <button
                type="submit"
                disabled={!canMoveUp}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-black/10 text-ink/60 transition hover:bg-black/[0.03] disabled:opacity-30"
                aria-label="Move up"
              >
                ↑
              </button>
            </form>
            <form action={moveSectionDown.bind(null, sectionKey)}>
              <button
                type="submit"
                disabled={!canMoveDown}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-black/10 text-ink/60 transition hover:bg-black/[0.03] disabled:opacity-30"
                aria-label="Move down"
              >
                ↓
              </button>
            </form>
          </div>
        )}
      </div>

      {def.fields.length === 0 ? (
        <p className="mt-2 text-xs text-ink/45">
          No section-level copy — each row is a real category with real businesses (see /admin/categories
          and each business&rsquo;s categories). This card only controls visibility and order.
        </p>
      ) : null}

      <form action={action} className="mt-3 flex flex-col gap-3">
        {def.imageSlots ? (
          <div>
            <div className="grid gap-3 sm:grid-cols-3">
              {Array.from({ length: def.imageSlots }, (_, i) => (
                <ImageField
                  key={i}
                  label={`Image ${i + 1}`}
                  name={`image_${i + 1}`}
                  defaultValue={resolved.images[i] ?? null}
                />
              ))}
            </div>
            <p className="mt-1.5 text-xs text-ink/45">
              Leave any slot blank to fall back to a real photo already on FindMi (a featured business or an
              upcoming appearance) — never a placeholder.
            </p>
          </div>
        ) : null}
        {def.fields.includes("eyebrow") && (
          <TextField label="Eyebrow" name="eyebrow" defaultValue={row?.eyebrow} placeholder={def.eyebrow} />
        )}
        {def.fields.includes("heading") && (
          // Textarea, not a single-line TextField (Discovery/Archive V2
          // Part 18) — the Hero's heading (and closing_cta's, which
          // already had embedded newlines in its own default) needs real
          // line breaks the founder can actually type, not just paste.
          <TextareaField
            label="Heading"
            name="heading"
            defaultValue={row?.heading}
            rows={3}
            hint={def.heading ? `Default: "${def.heading.replace(/\n/g, " / ")}" — press Enter for a new line.` : "Press Enter for a new line."}
          />
        )}
        {def.fields.includes("body") && (
          <TextareaField
            label="Body"
            name="body"
            defaultValue={row?.body}
            rows={2}
            hint={def.body ? `Default: "${def.body}"` : undefined}
          />
        )}
        {def.fields.includes("cta") && (
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="CTA Label" name="cta_label" defaultValue={row?.cta_label} placeholder={def.ctaLabel} />
            <TextField label="CTA URL" name="cta_url" defaultValue={row?.cta_url} placeholder={def.ctaUrl} />
          </div>
        )}

        <CheckboxField label="Visible" name="is_visible" defaultChecked={resolved.visible} />

        <button
          type="submit"
          className="self-start rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink transition hover:bg-findmi-600"
        >
          Save
        </button>
      </form>
    </div>
  );
}
