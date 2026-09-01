"use client";

import { useState } from "react";
import { CheckboxField, NumberField, TextField, TextareaField } from "@/components/admin/Fields";
import HomepageRowCuratedPicker from "@/components/admin/HomepageRowCuratedPicker";
import type { SearchResult } from "@/components/admin/RelationPicker";
import type { HomepageRow, HomepageRowContentType, HomepageRowMode } from "@/lib/homepage-rows";

const selectClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink focus:border-ink/30 focus:outline-none";

const CONTENT_TYPE_OPTIONS: { value: HomepageRowContentType; label: string }[] = [
  { value: "businesses", label: "Businesses" },
  { value: "events", label: "Events" },
  { value: "products", label: "Products" },
  { value: "business_showcase", label: "“Have a business?” Showcase" },
];

const MODE_OPTIONS: { value: HomepageRowMode; label: string }[] = [
  { value: "dynamic", label: "Dynamic — fills automatically from filters" },
  { value: "curated", label: "Curated — you hand-pick exactly what shows" },
];

const iconButtonClass =
  "flex h-7 w-7 items-center justify-center rounded-full border border-black/10 text-ink/60 transition hover:bg-black/[0.03] disabled:opacity-30";

/** One Homepage Row's founder-facing editor card. Content Type / Feed
 * selection is client-side so the right fields (dynamic filters vs the
 * curated picker) show immediately, without a page reload — everything
 * still submits through the one Server Action passed in via saveAction,
 * same pattern as every other admin form on FindMi. */
type CategoryOption = { slug: string; name: string };

export default function HomepageRowCard({
  row,
  categoriesByKind,
  curatedPreview,
  saveAction,
  deleteAction,
  moveUpAction,
  moveDownAction,
  canMoveUp,
  canMoveDown,
}: {
  row: HomepageRow;
  /** Kept split by kind (taxonomy foundation pass) — a row's Category
   * dropdown must only ever offer categories that its own content type
   * could actually match (getHomepageRowBusinesses/Events/Products are
   * all kind-scoped now), never every domain's categories mixed
   * together. */
  categoriesByKind: { business: CategoryOption[]; event: CategoryOption[]; product: CategoryOption[] };
  curatedPreview: SearchResult[];
  saveAction: (formData: FormData) => void;
  deleteAction: () => void;
  moveUpAction: () => void;
  moveDownAction: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const [contentType, setContentType] = useState<HomepageRowContentType>(row.content_type);
  const [mode, setMode] = useState<HomepageRowMode>(row.mode);

  const isShowcase = contentType === "business_showcase";
  const categories =
    contentType === "events" ? categoriesByKind.event : contentType === "products" ? categoriesByKind.product : categoriesByKind.business;

  return (
    <div className="rounded-2xl border border-black/10 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-display text-sm font-semibold tracking-tight text-ink">{row.title}</p>
        <div className="flex shrink-0 gap-1.5">
          <form action={moveUpAction}>
            <button type="submit" disabled={!canMoveUp} className={iconButtonClass} aria-label="Move up">
              ↑
            </button>
          </form>
          <form action={moveDownAction}>
            <button type="submit" disabled={!canMoveDown} className={iconButtonClass} aria-label="Move down">
              ↓
            </button>
          </form>
        </div>
      </div>

      <form action={saveAction} className="mt-3 flex flex-col gap-3">
        <TextField label="Row Title" name="title" defaultValue={row.title} required />
        <TextareaField label="Subtitle (optional)" name="subtitle" defaultValue={row.subtitle} rows={2} />

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
            This row shows FindMi&rsquo;s existing business-acquisition showcase — no items to pick. Use
            Visible and Move Up/Down below to control whether and where it appears.
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

            {mode === "dynamic" ? (
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

                <CheckboxField
                  label="Featured Only"
                  name="featured_only"
                  defaultChecked={row.featured_only}
                  hint="Only show items the founder has separately marked Featured."
                />

                <NumberField label="Items" name="item_limit" defaultValue={row.item_limit} step="1" hint="How many to show in this row." />
              </div>
            ) : (
              <HomepageRowCuratedPicker
                key={contentType}
                entity={contentType}
                initialItems={contentType === row.content_type ? curatedPreview : []}
              />
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

      <form action={deleteAction} className="mt-2">
        <button type="submit" className="text-xs font-semibold text-red-600 hover:underline">
          Delete Row
        </button>
      </form>
    </div>
  );
}
