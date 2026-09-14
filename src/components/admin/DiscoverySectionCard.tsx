"use client";

import { useState, type ReactNode } from "react";
import { CheckboxField, NumberField, TextField, TextareaField } from "@/components/admin/Fields";
import HomepageRowCuratedPicker from "@/components/admin/HomepageRowCuratedPicker";
import type { SearchResult } from "@/components/admin/RelationPicker";
import type { HomepageRow, HomepageRowContentType, HomepageRowMode, HomepageRowSectionType } from "@/lib/homepage-rows";

const selectClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink focus:border-ink/30 focus:outline-none";

const SECTION_TYPE_OPTIONS: { value: HomepageRowSectionType; label: string }[] = [
  { value: "feed", label: "Feed — shows real content" },
  { value: "group", label: "Group — a heading over child sections" },
];

const CONTENT_TYPE_OPTIONS: { value: HomepageRowContentType; label: string }[] = [
  { value: "businesses", label: "Businesses" },
  { value: "events", label: "Events" },
  { value: "products", label: "Products" },
  { value: "business_showcase", label: "“Have a business?” Showcase" },
];

const MODE_OPTIONS: { value: HomepageRowMode; label: string }[] = [
  { value: "dynamic", label: "Dynamic — fills automatically from filters" },
  { value: "curated", label: "Curated — you hand-pick exactly what shows" },
  { value: "hybrid", label: "Hybrid — pin some, auto-fill the rest" },
];

type CategoryOption = { slug: string; name: string };

/** One Discovery Page Section's founder-facing editor card — the Phase 1
 * generalization of HomepageRowCard (left untouched, still used as-is by
 * the existing /admin/site/homepage/rows editor) for the new multi-page,
 * groupable, hybrid-capable /admin/site/pages/[id] editor. Section
 * Type/Content Type/Feed are client-side so the right fields show
 * immediately; everything still submits through one Server Action, same
 * pattern as every other admin form on Findmi. The Move panel is rendered
 * server-side by the caller and passed in as `movePanel` — it needs no
 * client state of its own (native <details>, plain forms). */
export default function DiscoverySectionCard({
  row,
  categoriesByKind,
  curatedPreview,
  pinnedPreview,
  statusLabel,
  saveAction,
  deleteAction,
  movePanel,
}: {
  row: HomepageRow;
  categoriesByKind: { business: CategoryOption[]; event: CategoryOption[]; product: CategoryOption[] };
  curatedPreview: SearchResult[];
  pinnedPreview: SearchResult[];
  /** e.g. "Top level" or "Under: Find What's Happening" */
  statusLabel: string;
  saveAction: (formData: FormData) => void;
  deleteAction: () => void;
  movePanel: ReactNode;
}) {
  const [sectionType, setSectionType] = useState<HomepageRowSectionType>(row.section_type);
  const [contentType, setContentType] = useState<HomepageRowContentType>(row.content_type ?? "businesses");
  const [mode, setMode] = useState<HomepageRowMode>(row.mode);

  const isGroup = sectionType === "group";
  const isShowcase = contentType === "business_showcase";
  const categories =
    contentType === "events" ? categoriesByKind.event : contentType === "products" ? categoriesByKind.product : categoriesByKind.business;

  return (
    <div className="rounded-2xl border border-black/10 bg-white p-4">
      <p className="font-display text-sm font-semibold tracking-tight text-ink">{row.title}</p>
      <p className="mt-0.5 text-xs text-ink/45">
        {statusLabel} · {isGroup ? "Group" : "Feed"} · {row.is_visible ? "Visible" : "Hidden"}
      </p>

      <form action={saveAction} className="mt-3 flex flex-col gap-3">
        <TextField label="Heading" name="title" defaultValue={row.title} required />
        <TextareaField label="Description (optional)" name="subtitle" defaultValue={row.subtitle} rows={2} />

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Section Type</span>
          <select
            name="section_type"
            value={sectionType}
            onChange={(e) => setSectionType(e.target.value as HomepageRowSectionType)}
            className={selectClass}
          >
            {SECTION_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {isGroup ? (
          <p className="rounded-xl border border-black/10 bg-black/[0.02] px-3.5 py-3 text-xs text-ink/50">
            A Group has no content of its own — it&rsquo;s a heading over up to one level of child sections.
            Move a Feed section under this Group from that section&rsquo;s own Move panel below.
          </p>
        ) : (
          <>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">Content Type</span>
              <select
                name="content_type"
                value={contentType}
                onChange={(e) => setContentType(e.target.value as HomepageRowContentType)}
                className={selectClass}
              >
                {CONTENT_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            {isShowcase ? (
              <p className="rounded-xl border border-black/10 bg-black/[0.02] px-3.5 py-3 text-xs text-ink/50">
                Shows Findmi&rsquo;s existing business-acquisition showcase — no items to pick.
              </p>
            ) : (
              <>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-ink">Feed</span>
                  <select
                    name="mode"
                    value={mode}
                    onChange={(e) => setMode(e.target.value as HomepageRowMode)}
                    className={selectClass}
                  >
                    {MODE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>

                {mode !== "curated" && (
                  <div className="flex flex-col gap-3 rounded-xl border border-black/10 bg-black/[0.015] p-3">
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-ink">Category</span>
                      <select name="category_slug" defaultValue={row.category_slug ?? ""} className={selectClass}>
                        <option value="">Any category</option>
                        {categories.map((c) => (
                          <option key={c.slug} value={c.slug}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    {contentType === "events" && (
                      <label className="block">
                        <span className="mb-1.5 block text-sm font-medium text-ink">Time Window</span>
                        <select name="time_window" defaultValue={row.time_window ?? ""} className={selectClass}>
                          <option value="">Any time (all upcoming, chronological)</option>
                          <option value="now">Happening Now / Today</option>
                          <option value="weekend">This Weekend</option>
                        </select>
                      </label>
                    )}

                    {contentType !== "events" && (
                      <CheckboxField label="Featured Only" name="featured_only" defaultChecked={row.featured_only} />
                    )}

                    <NumberField
                      label={mode === "hybrid" ? "Total items (pinned + auto-filled)" : "Items"}
                      name="item_limit"
                      defaultValue={row.item_limit}
                      step="1"
                    />

                    {contentType === "businesses" && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <TextField
                          label="Market override (optional)"
                          name="market_slug"
                          defaultValue={row.market_slug}
                          hint="Blank inherits the page's Market context, if any."
                        />
                        <TextField
                          label="Area override (optional)"
                          name="area_slug"
                          defaultValue={row.area_slug}
                          hint="Only used alongside a Market."
                        />
                      </div>
                    )}
                  </div>
                )}

                {mode === "curated" && (
                  <HomepageRowCuratedPicker
                    key={`curated-${contentType}`}
                    entity={contentType}
                    initialItems={contentType === row.content_type ? curatedPreview : []}
                    fieldName="curated_id"
                  />
                )}

                {mode === "hybrid" && (
                  <div>
                    <p className="mb-1.5 text-sm font-medium text-ink">Pinned — render first, in this order</p>
                    <HomepageRowCuratedPicker
                      key={`pinned-${contentType}`}
                      entity={contentType}
                      initialItems={contentType === row.content_type ? pinnedPreview : []}
                      fieldName="pinned_id"
                    />
                    <p className="mt-1.5 text-xs text-ink/45">
                      The Items count above fills automatically after these pins, excluding anything already
                      pinned here.
                    </p>
                  </div>
                )}
              </>
            )}
          </>
        )}

        <CheckboxField label="Visible" name="is_visible" defaultChecked={row.is_visible} />

        <button
          type="submit"
          className="self-start rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Save
        </button>
      </form>

      {movePanel}

      <form action={deleteAction} className="mt-2">
        <button type="submit" className="text-xs font-semibold text-red-600 hover:underline">
          Delete {isGroup ? "Group" : "Section"}
        </button>
      </form>
    </div>
  );
}
