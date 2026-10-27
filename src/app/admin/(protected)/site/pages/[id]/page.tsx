import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { CheckboxField, TextField, TextareaField } from "@/components/admin/Fields";
import ImageField from "@/components/admin/ImageField";
import MarketAreaFields, { type MarketWithAreaOptions } from "@/components/MarketAreaFields";
import { guidePath } from "@/lib/guides";
import DiscoverySectionCard from "@/components/admin/DiscoverySectionCard";
import DiscoverySectionMovePanel from "@/components/admin/DiscoverySectionMovePanel";
import SectionCard from "@/components/admin/pages/SectionCard";
import EntityResultsForm from "@/components/admin/pages/EntityResultsForm";
import PreviewResults from "@/components/admin/pages/PreviewResults";
import type { RefItem } from "@/components/admin/pages/RefListField";
import { getAllCategories, getCuratedItemPreviews, getEntityRefPreviews } from "@/lib/admin/queries";
import { getAdminDiscoveryPage, resolveEffectiveSectionContext } from "@/lib/discovery-pages";
import { getAdminHomepageRows, type HomepageRow } from "@/lib/homepage-rows";
import { getVocabulary } from "@/lib/discovery/server";
import { isPageSectionKind } from "@/lib/section-types";
import { parseSectionConfig, SECTION_KIND_LABELS, summarizeEntitySection, type SectionConfig } from "@/lib/page-sections";
import { RESULTS_CAP, resolveEntityResults, type EntityResults } from "@/lib/page-sections-server";
import {
  createSection,
  deleteDiscoveryPage,
  deleteSection,
  saveDiscoveryPage,
  savePageSection,
  saveSection,
  setDiscoveryPagePublished,
  setSectionVisible,
  updateSectionRef,
} from "../actions";

const SAVED_MESSAGES: Record<string, string> = {
  created: "Section added — set it up below.",
  section: "Section saved.",
  page_created: "Page created — add Sections, then preview it.",
  published: "Published — the Page is now public.",
  unpublished: "Unpublished — the Page is a draft again and no longer public.",
  settings: "Page settings saved.",
};

const CONTENT_CHOICES = [
  { kind: "events", label: "Events & Appearances", help: "What's happening — dates and pop-ups." },
  { kind: "brands", label: "Brands", help: "Businesses to know." },
  { kind: "places", label: "Places", help: "Venues and locations." },
  { kind: "products", label: "Products", help: "Things to buy." },
];
const ELEMENT_CHOICES = [
  { kind: "rich_text", label: "Text & Editorial", help: "A heading, words, links, an image." },
  { kind: "map", label: "Map", help: "Everything above, on a map." },
];
const LEGACY_LABELS: Record<string, string> = { businesses: "Businesses", events: "Events", products: "Products", business_showcase: "Business Showcase" };

const groupSummary = "flex min-h-12 cursor-pointer select-none items-center justify-between gap-3 px-4 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden";

export const dynamic = "force-dynamic";

export default async function DiscoveryPageEditor({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string; edit?: string; results?: string }>;
}) {
  const { id: pageId } = await params;
  const { saved, error, edit, results: resultsFor } = await searchParams;

  const page = await getAdminDiscoveryPage(pageId);
  if (!page) notFound();
  const editorHref = `/admin/site/pages/${page.id}`;

  const [rows, vocab, businessCategories, eventCategories, productCategories, locationCategories, eventFormats] = await Promise.all([
    getAdminHomepageRows(pageId),
    getVocabulary(),
    getAllCategories("business"),
    getAllCategories("event"),
    getAllCategories("product"),
    getAllCategories("location"),
    getAllCategories("event_format"),
  ]);
  const categoriesByKind = { business: businessCategories, event: eventCategories, product: productCategories };
  const opt = (cats: { slug: string; name: string }[]) => cats.map((c) => ({ slug: c.slug, name: c.name }));
  const scopeCategories = { events: opt(eventCategories), brands: opt(businessCategories), places: opt(locationCategories), products: [] };

  // Markets / Areas keyed by slug — Pages and Sections store slugs.
  const markets: MarketWithAreaOptions[] = vocab.marketRows.map((m) => ({
    id: m.slug,
    name: m.name,
    areas: vocab.areaRows.filter((a) => a.market === m.slug).map((a) => ({ id: a.slug, name: a.level === "neighborhood" ? `· ${a.name}` : a.name })),
  }));
  const placeLabel = (market?: string, area?: string) => {
    if (!market) return null;
    const m = vocab.marketRows.find((x) => x.slug === market)?.name ?? market;
    const a = area ? (vocab.areaRows.find((x) => x.slug === area && x.market === market)?.name ?? area) : null;
    return a ? `${a}, ${m}` : m;
  };

  const topLevel = rows.filter((r) => !r.parent_id).sort((a, b) => a.sort_order - b.sort_order);
  const childrenByParent = new Map<string, HomepageRow[]>();
  for (const r of rows) {
    if (!r.parent_id) continue;
    const list = childrenByParent.get(r.parent_id) ?? [];
    list.push(r);
    childrenByParent.set(r.parent_id, list);
  }
  for (const list of childrenByParent.values()) list.sort((a, b) => a.sort_order - b.sort_order);
  const groupOptions = topLevel.filter((r) => r.section_type === "group").map((g) => ({ id: g.id, title: g.title }));

  // V1B Sections: parsed config (or why it's invalid) and live result counts
  // through the same public resolver the Guide renders with.
  const configs = new Map<string, { ok: true; value: SectionConfig } | { ok: false; error: string }>();
  for (const r of rows) if (isPageSectionKind(r.section_type)) configs.set(r.id, parseSectionConfig(r.section_type, r.config));
  const entityRows = rows.filter((r) => {
    const c = configs.get(r.id);
    return c?.ok && c.value.kind === "entity_results";
  });
  const entityConfig = (r: HomepageRow) => {
    const c = configs.get(r.id);
    return c?.ok && c.value.kind === "entity_results" ? c.value.config : null;
  };
  const scopeOf = (r: HomepageRow) => {
    const ctx = resolveEffectiveSectionContext(page, r);
    return { marketSlug: ctx.marketSlug, areaSlug: ctx.areaSlug };
  };
  const resolvedResults = new Map<string, EntityResults>(
    await Promise.all(entityRows.map(async (r) => [r.id, await resolveEntityResults(entityConfig(r)!, scopeOf(r), r.id === resultsFor ? { limit: RESULTS_CAP } : {})] as const))
  );

  // Labels for the references of the Section being edited / previewed.
  const focus = rows.find((r) => r.id === edit || r.id === resultsFor);
  const focusConfig = focus ? entityConfig(focus) : null;
  const focusRefs = focusConfig
    ? [...focusConfig.pins, ...focusConfig.includes, ...focusConfig.excludes, ...(focusConfig.filters.brands ?? []).map((id) => ({ kind: "business", id })), ...(focusConfig.filters.places ?? []).map((id) => ({ kind: "place", id }))]
    : [];
  const refLabelMap = await getEntityRefPreviews(focusRefs);
  const refLabels: Record<string, RefItem> = Object.fromEntries([...refLabelMap].map(([k, v]) => [k, { value: k, label: v.label, sublabel: v.sublabel, image_url: v.image_url }]));

  // Legacy Feed editor previews — only for the Section being edited.
  const editRow = rows.find((r) => r.id === edit);
  const legacyType = editRow && editRow.section_type === "feed" && editRow.content_type && editRow.content_type !== "business_showcase" ? editRow.content_type : null;
  const [curatedPreview, pinnedPreview] = legacyType
    ? await Promise.all([getCuratedItemPreviews(legacyType, editRow!.curated_ids), getCuratedItemPreviews(legacyType, editRow!.pinned_ids)])
    : [[], []];

  function summary(row: HomepageRow): { kindLabel: string; primary: string | null; secondary: string | null; warning?: string } {
    const parsed = configs.get(row.id);
    if (parsed && !parsed.ok) return { kindLabel: SECTION_KIND_LABELS[row.section_type as keyof typeof SECTION_KIND_LABELS] ?? "Section", primary: null, secondary: null, warning: `This Section's settings need attention and it isn't shown: ${parsed.error}` };
    if (parsed?.ok && parsed.value.kind === "entity_results") {
      const ctx = scopeOf(row);
      const count = resolvedResults.get(row.id)?.items.slice(0, parsed.value.config.limit).length ?? null;
      const s = summarizeEntitySection(parsed.value.config, { count, place: parsed.value.config.scope === "products" ? null : placeLabel(ctx.marketSlug, ctx.areaSlug) });
      return { kindLabel: "Results", ...s, warning: count === 0 ? "Nothing matches right now — this Section stays hidden on the Page until something does." : undefined };
    }
    if (parsed?.ok && parsed.value.kind === "rich_text") {
      const body = parsed.value.config.body.replace(/\s+/g, " ").trim();
      return { kindLabel: "Text & Editorial", primary: body ? (body.length > 90 ? `${body.slice(0, 90)}…` : body) : "No text yet", secondary: [parsed.value.config.image_url ? "Image" : null, parsed.value.config.cta_label ? `Button: ${parsed.value.config.cta_label}` : null].filter(Boolean).join(" · ") || null };
    }
    if (parsed?.ok && parsed.value.kind === "map") {
      const n = parsed.value.config.sections.length;
      return { kindLabel: "Map", primary: n ? `Plots ${n} Results ${n === 1 ? "Section" : "Sections"}` : "Plots every Results Section on this Page", secondary: "Only entities with a real Location appear." };
    }
    if (row.section_type === "group") {
      const n = childrenByParent.get(row.id)?.length ?? 0;
      return { kindLabel: "Group", primary: `${n} ${n === 1 ? "Section" : "Sections"} inside`, secondary: row.subtitle };
    }
    if (row.section_type === "feed") return { kindLabel: "Feed", primary: [LEGACY_LABELS[row.content_type ?? ""] ?? "Unknown", row.content_type === "business_showcase" ? null : row.mode[0].toUpperCase() + row.mode.slice(1)].filter(Boolean).join(" · "), secondary: placeLabel(row.market_slug ?? undefined, row.area_slug ?? undefined) };
    return { kindLabel: "Unknown", primary: null, secondary: null, warning: "This Section type isn't supported and isn't shown." };
  }

  function editor(row: HomepageRow): ReactNode {
    const parsed = configs.get(row.id);
    const save = savePageSection.bind(null, row.id, pageId);
    if (parsed?.ok && parsed.value.kind === "entity_results") {
      const c = parsed.value.config;
      return (
        <EntityResultsForm
          action={save}
          title={row.title}
          subtitle={row.subtitle}
          isVisible={row.is_visible}
          marketSlug={row.market_slug}
          areaSlug={row.area_slug}
          config={c}
          markets={markets}
          categories={scopeCategories[c.scope]}
          formats={c.scope === "events" ? opt(eventFormats) : []}
          refLabels={refLabels}
        />
      );
    }
    if (parsed?.ok && parsed.value.kind === "rich_text") {
      const c = parsed.value.config;
      return (
        <form action={save} className="flex flex-col gap-3">
          <TextField label="Heading" name="title" defaultValue={row.title} required />
          <TextareaField label="Subheading (Optional)" name="subtitle" defaultValue={row.subtitle} rows={2} />
          <TextareaField
            label="Text"
            name="body"
            defaultValue={c.body}
            rows={8}
            hint="A blank line starts a new paragraph. Start a line with “- ” for a bullet or “### ” for a small heading. Links: [Label](https://… or /path)."
          />
          <ImageField variant="media" label="Image (Optional)" name="image_url" defaultValue={c.image_url} />
          <TextField label="Image Alt Text" name="image_alt" defaultValue={c.image_alt} hint="Describes the image for screen readers." />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Button Label (Optional)" name="cta_label" defaultValue={c.cta_label} placeholder="e.g. See The Course" />
            <TextField label="Button Destination" name="cta_url" defaultValue={c.cta_url} placeholder="https://… or /events" />
          </div>
          <CheckboxField label="Visible" name="is_visible" defaultChecked={row.is_visible} />
          <SaveButton label="Save Text" />
        </form>
      );
    }
    if (parsed?.ok && parsed.value.kind === "map") {
      const chosen = new Set(parsed.value.config.sections);
      return (
        <form action={save} className="flex flex-col gap-3">
          <TextField label="Heading" name="title" defaultValue={row.title} required />
          <TextareaField label="Description (Optional)" name="subtitle" defaultValue={row.subtitle} rows={2} />
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-ink">Plot These Results Sections</legend>
            {entityRows.length === 0 ? (
              <p className="text-xs text-ink/45">Add an Events & Appearances, Brands or Places Section — the Map plots what it shows.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {entityRows.map((r) => (
                  <label key={r.id} className="flex min-h-10 items-center gap-2.5 rounded-lg px-2 text-sm text-ink hover:bg-black/[0.03]">
                    <input type="checkbox" name="map_section" value={r.id} defaultChecked={chosen.has(r.id)} className="h-4 w-4 accent-findmi" />
                    {r.title}
                  </label>
                ))}
              </div>
            )}
            <p className="mt-1.5 text-xs text-ink/45">None ticked = every Results Section. Products aren&rsquo;t mapped; anything without a real Location is left off.</p>
          </fieldset>
          <CheckboxField label="Visible" name="is_visible" defaultChecked={row.is_visible} />
          <SaveButton label="Save Map" />
        </form>
      );
    }
    if (parsed && !parsed.ok) return <p className="text-sm text-ink/60">These settings can&rsquo;t be edited here. Delete this Section and add a new one.</p>;
    // Legacy Feed / Group — the existing Phase 1 editor, unchanged.
    return (
      <DiscoverySectionCard
        row={row}
        categoriesByKind={categoriesByKind}
        curatedPreview={curatedPreview}
        pinnedPreview={pinnedPreview}
        statusLabel={row.parent_id ? "In a Group" : "Top level"}
        saveAction={saveSection.bind(null, row.id, pageId)}
        deleteAction={deleteSection.bind(null, row.id, pageId)}
        movePanel={null}
      />
    );
  }

  function renderSection(row: HomepageRow, siblings: HomepageRow[]) {
    const s = summary(row);
    const config = entityConfig(row);
    const open = row.id === edit ? "edit" : row.id === resultsFor && config ? "results" : null;
    const results = resolvedResults.get(row.id);
    return (
      <SectionCard
        key={row.id}
        id={row.id}
        kindLabel={s.kindLabel}
        title={row.title}
        primary={s.primary}
        secondary={s.secondary}
        warning={s.warning}
        isVisible={row.is_visible}
        editHref={`${editorHref}?edit=${row.id}#section-${row.id}`}
        resultsHref={config ? `${editorHref}?results=${row.id}#section-${row.id}` : undefined}
        closeHref={`${editorHref}#section-${row.id}`}
        open={open}
        visibilityAction={setSectionVisible.bind(null, row.id, pageId, !row.is_visible)}
        deleteAction={deleteSection.bind(null, row.id, pageId)}
        movePanel={
          <DiscoverySectionMovePanel
            id={row.id}
            pageId={pageId}
            isGroup={row.section_type === "group"}
            parentId={row.parent_id}
            position={siblings.findIndex((x) => x.id === row.id) + 1}
            siblingCount={siblings.length}
            siblings={siblings.filter((x) => x.id !== row.id).map((x) => ({ id: x.id, title: x.title }))}
            groups={groupOptions}
          />
        }
      >
        {open === "edit" && editor(row)}
        {open === "results" && config && results && (
          <PreviewResults config={config} results={results} excludedLabels={config.excludes.map((r) => refLabels[`${r.kind}:${r.id}`] ?? { value: `${r.kind}:${r.id}`, label: "Unavailable item" })} refAction={updateSectionRef.bind(null, row.id, pageId)} />
        )}
      </SectionCard>
    );
  }


  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-ink/45">
        <Link href="/admin/site/pages" className="hover:underline">
          Pages
        </Link>
        <span>/</span>
        <span className="truncate">{page.internal_name}</span>
      </div>
      <h1 className="mt-1 break-words font-display text-2xl font-semibold tracking-tight text-ink">{page.title}</h1>

      {error && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {saved && !error && <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">{SAVED_MESSAGES[saved] ?? "Saved."}</p>}

      {/* Status + publication (normal Pages) */}
      {!page.is_system && (
        <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-black/10 bg-white p-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${page.is_published ? "bg-findmi-50 text-findmi-700" : "bg-black/5 text-ink/50"}`}>
                {page.is_published ? "Published" : "Draft"}
              </span>
              {page.is_published ? (
                <Link href={guidePath(page.slug)} className="truncate text-xs font-semibold text-findmi-700 hover:underline">
                  {guidePath(page.slug)}
                </Link>
              ) : (
                <span className="truncate text-xs font-normal text-ink/50">Not public · {guidePath(page.slug)}</span>
              )}
            </p>
            {page.published_at && <p className="mt-1 text-xs text-ink/45">First published {new Date(page.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/admin/site/pages/${page.id}/preview`} className="inline-flex min-h-10 items-center rounded-full border border-black/15 px-4 text-xs font-bold uppercase tracking-wide text-ink transition hover:border-black/30">
              Preview
            </Link>
            <form action={setDiscoveryPagePublished.bind(null, page.id, !page.is_published)}>
              <button
                type="submit"
                className={`inline-flex min-h-10 items-center rounded-full px-4 text-xs font-bold uppercase tracking-wide transition ${page.is_published ? "border border-red-200 text-red-700 hover:border-red-300" : "bg-findmi text-white hover:bg-findmi-600"}`}
              >
                {page.is_published ? "Unpublish" : "Publish"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Sections — the main authoring surface */}
      <div className="mt-6 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-semibold tracking-tight text-ink">Sections</h2>
        <span className="text-xs text-ink/45">{rows.length} total</span>
      </div>

      {topLevel.length === 0 ? (
        <p className="mt-2 text-sm text-ink/45">No Sections yet — add the first one below.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {topLevel.map((row) => (
            <div key={row.id}>
              {renderSection(row, topLevel)}
              {row.section_type === "group" && (childrenByParent.get(row.id)?.length ?? 0) > 0 && (
                <div className="ml-3 mt-2 flex flex-col gap-2 border-l-2 border-black/10 pl-3">
                  {(childrenByParent.get(row.id) ?? []).map((child) => renderSection(child, childrenByParent.get(row.id) ?? []))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <details className="group mt-4 rounded-2xl border border-dashed border-black/15 bg-black/[0.015]" open={topLevel.length === 0}>
        <summary className={`${groupSummary} text-findmi-700`}>
          + Add Section
          <span className="text-xs font-normal text-ink/40 group-open:hidden">Choose a type</span>
        </summary>
        <form action={createSection.bind(null, pageId)} className="flex flex-col gap-3 px-4 pb-4">
          {!page.is_system && (
            <>
              <ChoiceGrid title="Content" choices={CONTENT_CHOICES} />
              <ChoiceGrid title="Page Elements" choices={ELEMENT_CHOICES} />
            </>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-ink/50">
            {page.is_system && (
              <button type="submit" name="kind" value="feed" className="inline-flex min-h-10 items-center rounded-full border border-black/10 bg-white px-3.5 font-semibold text-ink/70">
                + Feed
              </button>
            )}
            <span>{page.is_system ? "Or" : "Need one heading over several Sections?"}</span>
            <button type="submit" name="kind" value="group" className="inline-flex min-h-10 items-center rounded-full border border-black/10 bg-white px-3.5 font-semibold text-ink/70">
              + Group
            </button>
          </div>
        </form>
      </details>

      {/* Page Settings — grouped, collapsed */}
      <h2 className="mt-8 font-display text-lg font-semibold tracking-tight text-ink">Page Settings</h2>
      {!page.is_system && <p className="mt-0.5 text-xs text-ink/45">Saving never publishes or unpublishes — use Publish above.</p>}
      <form action={saveDiscoveryPage.bind(null, page.id, page.is_system)} className="mt-3 flex flex-col gap-2">
        <SettingsGroup title="Basics" open={saved === "page_created"}>
          <TextField label="Title" name="title" defaultValue={page.title} required />
          <TextareaField label="Description" name="description" defaultValue={page.description} rows={3} />
          {page.is_system ? (
            <p className="rounded-xl border border-black/10 bg-black/[0.02] px-3.5 py-3 text-xs text-ink/50">System page — route /, always published; its slug and publication can&rsquo;t change.</p>
          ) : (
            <TextField label="Slug" name="slug" defaultValue={page.slug} hint={`Public address: ${guidePath(page.slug)}`} />
          )}
          <TextField label="Internal Name" name="internal_name" defaultValue={page.internal_name} hint="Only shown in Admin. Blank uses the Title." />
        </SettingsGroup>

        {!page.is_system && (
          <>
            <SettingsGroup title="Hero" detail={page.hero_image_url ? "Image set" : null}>
              <ImageField variant="media" label="Hero Image" name="hero_image_url" defaultValue={page.hero_image_url} />
              <TextField label="Hero Image Alt Text" name="hero_image_alt" defaultValue={page.hero_image_alt} hint="Describes the image for screen readers." />
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label="Button Label" name="cta_label" defaultValue={page.cta_label} placeholder="e.g. Get Race Info" />
                <TextField label="Button Destination" name="cta_url" defaultValue={page.cta_url} placeholder="https://… or /events" hint="https:// link or a Findmi path starting with /." />
              </div>
            </SettingsGroup>
            <SettingsGroup title="Publishing" detail={page.starts_on || page.ends_on ? "Dates set" : null}>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label="Coverage Starts" name="starts_on" type="date" defaultValue={page.starts_on} />
                <TextField label="Coverage Ends" name="ends_on" type="date" defaultValue={page.ends_on} />
              </div>
              <p className="text-xs text-ink/45">Shown on the Guide. Dates never publish or unpublish it; after the end date it stays public, marked as a past Guide.</p>
            </SettingsGroup>
            <SettingsGroup title="SEO & Sharing" detail={page.seo_title || page.og_image_url ? "Customized" : null}>
              <TextField label="SEO Title" name="seo_title" defaultValue={page.seo_title} hint="Defaults to the Title." />
              <TextareaField label="SEO Description" name="seo_description" defaultValue={page.seo_description} rows={2} />
              <ImageField variant="media" label="Share Image" name="og_image_url" defaultValue={page.og_image_url} hint="Defaults to the Hero Image." />
            </SettingsGroup>
          </>
        )}

        <SettingsGroup title="Market & Area" detail={placeLabel(page.market_slug ?? undefined, page.area_slug ?? undefined)}>
          <p className="text-xs text-ink/45">Results Sections use this unless they set their own.</p>
          <MarketAreaFields markets={markets} defaultMarketId={page.market_slug} defaultAreaId={page.area_slug} marketFieldName="market_slug" areaFieldName="area_slug" blankMarketOptionLabel="None" noSpecificAreaLabel="Any Area" />
          <details>
            <summary className="cursor-pointer select-none text-xs font-semibold text-ink/50">Advanced</summary>
            <div className="mt-2">
              <TextField label="Legacy Category" name="category_slug" defaultValue={page.category_slug} hint="Only used by legacy Feed Sections." />
            </div>
          </details>
        </SettingsGroup>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <SaveButton label="Save Page Settings" dark />
        </div>
      </form>
      {!page.is_system && (
        <form action={deleteDiscoveryPage.bind(null, page.id, page.is_system)} className="mt-4">
          <button type="submit" className="text-xs font-semibold text-red-600 hover:underline">
            Delete Page
          </button>
        </form>
      )}
    </div>
  );
}

function ChoiceGrid({ title, choices }: { title: string; choices: { kind: string; label: string; help: string }[] }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-ink/40">{title}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {choices.map((c) => (
          <button key={c.kind} type="submit" name="kind" value={c.kind} className="flex min-h-[72px] flex-col items-start justify-start gap-0.5 rounded-xl border border-black/10 bg-white p-3 text-left transition hover:border-findmi/50 active:scale-[0.99]">
            <span className="text-sm font-semibold leading-snug text-ink">{c.label}</span>
            <span className="text-xs leading-snug text-ink/50">{c.help}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SettingsGroup({ title, detail, open = false, children }: { title: string; detail?: string | null; open?: boolean; children: ReactNode }) {
  return (
    <details className="group rounded-2xl border border-black/10 bg-white" open={open}>
      <summary className={groupSummary}>
        <span>{title}</span>
        <span className="truncate text-xs font-normal text-ink/45">
          {detail}
          <span className="ml-2 inline-block transition group-open:rotate-180">▾</span>
        </span>
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4">{children}</div>
    </details>
  );
}

function SaveButton({ label, dark = false }: { label: string; dark?: boolean }) {
  return (
    <button type="submit" className={`inline-flex min-h-11 items-center self-start rounded-full px-5 text-xs font-bold uppercase tracking-wide text-white transition ${dark ? "bg-ink hover:bg-ink/85" : "bg-findmi hover:bg-findmi-600"}`}>
      {label}
    </button>
  );
}

