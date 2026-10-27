"use client";

import { useState } from "react";
import { CheckboxField, TextField, TextareaField } from "@/components/admin/Fields";
import MarketAreaFields, { type MarketWithAreaOptions } from "@/components/MarketAreaFields";
import RefListField, { type RefItem } from "./RefListField";
import {
  ENTITY_MODES,
  ENTITY_MODE_LABELS,
  ENTITY_SCOPE_LABELS,
  RESULT_FLAG_LABELS,
  RESULT_FLAGS,
  SCOPE_FILTERS,
  SECTION_LIMITS,
  type EntityMode,
  type EntityScope,
  type ResultWhen,
} from "@/lib/section-types";
import type { EntityResultsConfig } from "@/lib/page-sections";

const selectClass = "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink focus:border-ink/30 focus:outline-none";
const groupClass = "flex flex-col gap-3 rounded-xl border border-black/10 bg-black/[0.015] p-3";
const legendClass = "text-xs font-bold uppercase tracking-wide text-ink/40";

const MODE_HELP: Record<EntityMode, string> = {
  manual: "Only what you pick, in your order.",
  dynamic: "Fills automatically from the filters.",
  hybrid: "Pins first, your picks, then the filters fill the rest.",
};

const WHEN_OPTIONS: { value: ResultWhen | ""; label: string }[] = [
  { value: "upcoming", label: "Anything Upcoming" },
  { value: "now", label: "Happening Now" },
  { value: "today", label: "Today" },
  { value: "tonight", label: "Tonight" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "weekend", label: "This Weekend" },
  { value: "week", label: "This Week" },
  { value: "next_week", label: "Next Week" },
  { value: "month", label: "This Month" },
];

const SEARCH: Record<EntityScope, { entity: "events" | "businesses" | "locations" | "products"; kind: string }> = {
  events: { entity: "events", kind: "event" },
  brands: { entity: "businesses", kind: "business" },
  places: { entity: "locations", kind: "place" },
  products: { entity: "products", kind: "product" },
};

type Option = { slug: string; name: string };

/** Pages + Sections V1B — the Entity Results Section editor (Events &
 * Appearances / Brands / Places / Products). One form, one Server Action
 * (savePageSection). Lists that a mode doesn't use stay in the form
 * (hidden), so switching modes never loses picks, pins or exclusions. */
export default function EntityResultsForm({
  action,
  title,
  subtitle,
  isVisible,
  marketSlug,
  areaSlug,
  config,
  markets,
  categories,
  formats,
  refLabels,
}: {
  action: (formData: FormData) => void;
  title: string;
  subtitle: string | null;
  isVisible: boolean;
  marketSlug: string | null;
  areaSlug: string | null;
  config: EntityResultsConfig;
  /** Markets / Areas keyed by slug (Pages store slugs). */
  markets: MarketWithAreaOptions[];
  categories: Option[];
  formats: Option[];
  refLabels: Record<string, RefItem>;
}) {
  const [mode, setMode] = useState<EntityMode>(config.mode);
  const f = config.filters;
  const allowed = new Set(SCOPE_FILTERS[config.scope]);
  const search = SEARCH[config.scope];
  const label = (value: string, fallback: string): RefItem => refLabels[value] ?? { value, label: fallback, sublabel: "No longer available" };
  const refItems = (list: { kind: string; id: string }[]) => list.map((r) => label(`${r.kind}:${r.id}`, "Unavailable item"));
  const idItems = (ids: string[] | undefined, kind: string) => (ids ?? []).map((id) => ({ ...label(`${kind}:${id}`, "Unavailable"), value: id }));
  const usesFilters = mode !== "manual";

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="scope" value={config.scope} />
      <TextField label="Heading" name="title" defaultValue={title} required />
      <TextareaField label="Description (Optional)" name="subtitle" defaultValue={subtitle} rows={2} />

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink">How Results Are Chosen</legend>
        <div className="grid grid-cols-3 gap-1.5" role="radiogroup">
          {ENTITY_MODES.map((m) => (
            <label key={m} className={`flex min-h-11 cursor-pointer items-center justify-center rounded-xl border px-2 text-center text-sm font-semibold transition ${mode === m ? "border-findmi bg-findmi text-white" : "border-black/10 bg-white text-ink/70"}`}>
              <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="sr-only" />
              {ENTITY_MODE_LABELS[m]}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-ink/50">{MODE_HELP[mode]}</p>
      </fieldset>

      <div className={mode === "hybrid" ? "" : "hidden"}>
        <RefListField name="pin" label="Pinned First" hint="Always shown first, in this order." search={search.entity} refKind={search.kind} initial={refItems(config.pins)} ordered />
      </div>
      <div className={mode === "dynamic" ? "hidden" : ""}>
        <RefListField
          name="include"
          label={mode === "manual" ? "Items" : "Also Include"}
          hint={config.scope === "events" ? "Search Events here; add a Pop-Up from Preview Results." : undefined}
          search={search.entity}
          refKind={search.kind}
          initial={refItems(config.includes)}
          ordered
        />
      </div>

      <div className={usesFilters ? groupClass : "hidden"}>
        <p className={legendClass}>Filters</p>
        {allowed.has("when") && (
          <>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">When</span>
              <select name="when" defaultValue={f.when ?? ""} className={selectClass}>
                {WHEN_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <details className="rounded-xl border border-black/10 bg-white p-3" open={Boolean(f.date || f.from || f.to)}>
              <summary className="cursor-pointer select-none text-sm font-semibold text-ink">Specific Dates</summary>
              <div className="mt-3 flex flex-col gap-3">
                <TextField label="One Date" name="date" type="date" defaultValue={f.date} hint="Overrides the range and When." />
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField label="From" name="from" type="date" defaultValue={f.from} />
                  <TextField label="To" name="to" type="date" defaultValue={f.to} />
                </div>
              </div>
            </details>
          </>
        )}

        {config.scope !== "products" && (
          <MarketAreaFields
            markets={markets}
            defaultMarketId={marketSlug}
            defaultAreaId={areaSlug}
            marketFieldName="market_slug"
            areaFieldName="area_slug"
            blankMarketOptionLabel="Same As Page"
            noSpecificAreaLabel="Any Area"
          />
        )}

        {allowed.has("categories") && categories.length > 0 && <ChoiceList name="category" label="Categories" options={categories} selected={f.categories ?? []} />}
        {allowed.has("formats") && formats.length > 0 && <ChoiceList name="format" label="Formats" options={formats} selected={f.formats ?? []} />}
        {allowed.has("text") && <TextField label="Matching Text" name="text" defaultValue={f.text} placeholder="e.g. marathon" hint="Every word must match the name, venue or brand." />}

        {RESULT_FLAGS.some((k) => allowed.has(k)) && (
          <div>
            <span className="mb-1.5 block text-sm font-medium text-ink">Only Show</span>
            <div className="flex flex-wrap gap-1.5">
              {RESULT_FLAGS.filter((k) => allowed.has(k)).map((k) => (
                <label key={k} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border border-black/10 bg-white px-3.5 text-sm text-ink has-[:checked]:border-findmi has-[:checked]:bg-findmi-50 has-[:checked]:text-findmi-700">
                  <input type="checkbox" name="flag" value={k} defaultChecked={Boolean(f[k])} className="h-4 w-4 accent-findmi" />
                  {RESULT_FLAG_LABELS[k]}
                </label>
              ))}
            </div>
          </div>
        )}

        {allowed.has("brands") && <RefListField name="brand" label="Brand" hint="Hosted by, participating in, or popping up as any of these." search="businesses" refKind={null} initial={idItems(f.brands, "business")} />}
        {allowed.has("places") && <RefListField name="place" label="Place" hint="Happening at any of these Places." search="locations" refKind={null} initial={idItems(f.places, "place")} />}
      </div>

      <div className={usesFilters ? "" : "hidden"}>
        <RefListField name="exclude" label="Excluded" hint="Never shown here, whatever the filters match. Exclude from Preview Results, or search." search={search.entity} refKind={search.kind} initial={refItems(config.excludes)} emptyText="Nothing excluded." />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Items To Show</span>
          <input type="number" name="limit" min={1} max={SECTION_LIMITS.itemsPerSection} defaultValue={config.limit} className={selectClass} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Layout</span>
          <select name="layout" defaultValue={config.layout} className={selectClass}>
            <option value="carousel">Carousel</option>
            <option value="grid">Grid</option>
          </select>
        </label>
      </div>

      <CheckboxField label="Visible" name="is_visible" defaultChecked={isVisible} />
      <button type="submit" className="min-h-11 self-start rounded-full bg-findmi px-5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600">
        Save {ENTITY_SCOPE_LABELS[config.scope]}
      </button>
    </form>
  );
}

function ChoiceList({ name, label, options, selected }: { name: string; label: string; options: Option[]; selected: string[] }) {
  const [q, setQ] = useState("");
  const chosen = new Set(selected);
  const shown = options.filter((o) => !q || o.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <details className="rounded-xl border border-black/10 bg-white p-3" open={selected.length > 0}>
      <summary className="cursor-pointer select-none text-sm font-semibold text-ink">
        {label}
        {selected.length > 0 && <span className="ml-1.5 text-ink/45">({selected.length})</span>}
      </summary>
      {options.length > 8 && (
        <input autoCapitalize="none" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${label.toLowerCase()}…`} className={`mt-3 ${selectClass}`} aria-label={`Search ${label}`} />
      )}
      <div className="mt-3 flex max-h-64 flex-col gap-1 overflow-y-auto">
        {options.map((o) => (
          <label key={o.slug} className={`flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm text-ink hover:bg-black/[0.03] ${shown.includes(o) ? "" : "hidden"}`}>
            <input type="checkbox" name={name} value={o.slug} defaultChecked={chosen.has(o.slug)} className="h-4 w-4 accent-findmi" />
            {o.name}
          </label>
        ))}
      </div>
    </details>
  );
}
