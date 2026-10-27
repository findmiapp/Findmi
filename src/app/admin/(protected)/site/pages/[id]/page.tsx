import Link from "next/link";
import { notFound } from "next/navigation";
import { TextField, TextareaField } from "@/components/admin/Fields";
import ImageField from "@/components/admin/ImageField";
import { guidePath } from "@/lib/guides";
import DiscoverySectionCard from "@/components/admin/DiscoverySectionCard";
import DiscoverySectionMovePanel from "@/components/admin/DiscoverySectionMovePanel";
import { getAllCategories, getCuratedItemPreviews } from "@/lib/admin/queries";
import { getAdminDiscoveryPage } from "@/lib/discovery-pages";
import { getAdminHomepageRows, type HomepageRow } from "@/lib/homepage-rows";
import { createSection, deleteDiscoveryPage, deleteSection, saveDiscoveryPage, saveSection, setDiscoveryPagePublished } from "../actions";

const SAVED_MESSAGES: Record<string, string> = {
  created: "Section added — configure it below.",
  page_created: "Page created — add its details and Sections, then preview it.",
  published: "Published — the Page is now public.",
  unpublished: "Unpublished — the Page is a draft again and no longer public.",
};

export const dynamic = "force-dynamic";

export default async function DiscoveryPageEditor({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { id: pageId } = await params;
  const { saved, error } = await searchParams;

  const page = await getAdminDiscoveryPage(pageId);
  if (!page) notFound();

  const [rows, businessCategories, eventCategories, productCategories] = await Promise.all([
    getAdminHomepageRows(pageId),
    getAllCategories("business"),
    getAllCategories("event"),
    getAllCategories("product"),
  ]);
  const categoriesByKind = { business: businessCategories, event: eventCategories, product: productCategories };

  const topLevel = rows.filter((r) => !r.parent_id).sort((a, b) => a.sort_order - b.sort_order);
  const childrenByParent = new Map<string, HomepageRow[]>();
  for (const r of rows) {
    if (!r.parent_id) continue;
    const list = childrenByParent.get(r.parent_id) ?? [];
    list.push(r);
    childrenByParent.set(r.parent_id, list);
  }
  for (const list of childrenByParent.values()) list.sort((a, b) => a.sort_order - b.sort_order);

  const groupOptions = topLevel
    .filter((r) => r.section_type === "group")
    .map((g) => ({ id: g.id, title: g.title }));

  // One preview fetch per row that actually needs one (curated mode's
  // curated_ids, or hybrid mode's pinned_ids) — same batching shape as the
  // existing /admin/site/homepage/rows editor.
  const [curatedPreviews, pinnedPreviews] = await Promise.all([
    Promise.all(
      rows.map((row) =>
        row.mode === "curated" && row.content_type && row.content_type !== "business_showcase" && row.curated_ids.length > 0
          ? getCuratedItemPreviews(row.content_type, row.curated_ids)
          : Promise.resolve([])
      )
    ),
    Promise.all(
      rows.map((row) =>
        row.mode === "hybrid" && row.content_type && row.content_type !== "business_showcase" && row.pinned_ids.length > 0
          ? getCuratedItemPreviews(row.content_type, row.pinned_ids)
          : Promise.resolve([])
      )
    ),
  ]);
  const previewIndex = new Map(rows.map((r, i) => [r.id, i]));

  function renderSection(row: HomepageRow, siblings: HomepageRow[], statusLabel: string) {
    const i = previewIndex.get(row.id)!;
    const position = siblings.findIndex((s) => s.id === row.id) + 1;
    return (
      <DiscoverySectionCard
        key={row.id}
        row={row}
        categoriesByKind={categoriesByKind}
        curatedPreview={curatedPreviews[i]}
        pinnedPreview={pinnedPreviews[i]}
        statusLabel={statusLabel}
        saveAction={saveSection.bind(null, row.id, pageId)}
        deleteAction={deleteSection.bind(null, row.id, pageId)}
        movePanel={
          <DiscoverySectionMovePanel
            id={row.id}
            pageId={pageId}
            isGroup={row.section_type === "group"}
            parentId={row.parent_id}
            position={position}
            siblingCount={siblings.length}
            siblings={siblings.filter((s) => s.id !== row.id).map((s) => ({ id: s.id, title: s.title }))}
            groups={groupOptions}
          />
        }
      />
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-ink/45">
        <Link href="/admin/site/pages" className="hover:underline">
          Pages
        </Link>
        <span>/</span>
        <span>{page.internal_name}</span>
      </div>
      <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">{page.internal_name}</h1>

      {error && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          {SAVED_MESSAGES[saved] ?? "Saved."}
        </p>
      )}

      {/* Page status + publication (normal Pages) */}
      {!page.is_system && (
        <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-black/10 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              Status
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  page.is_published ? "bg-findmi-50 text-findmi-700" : "bg-black/5 text-ink/50"
                }`}
              >
                {page.is_published ? "Published" : "Draft"}
              </span>
            </p>
            <p className="mt-1 break-all text-xs text-ink/50">
              {page.is_published ? (
                <>
                  Public at{" "}
                  <Link href={guidePath(page.slug)} className="font-semibold text-findmi-700 hover:underline">
                    {guidePath(page.slug)}
                  </Link>
                </>
              ) : (
                <>Not public. Once published: {guidePath(page.slug)}</>
              )}
              {page.published_at && <> · First published {new Date(page.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/admin/site/pages/${page.id}/preview`}
              className="inline-flex min-h-10 items-center rounded-full border border-black/15 px-4 text-xs font-bold uppercase tracking-wide text-ink transition hover:border-black/30"
            >
              Preview
            </Link>
            <form action={setDiscoveryPagePublished.bind(null, page.id, !page.is_published)}>
              <button
                type="submit"
                className={`inline-flex min-h-10 items-center rounded-full px-4 text-xs font-bold uppercase tracking-wide transition ${
                  page.is_published ? "border border-red-200 text-red-700 hover:border-red-300" : "bg-findmi text-white hover:bg-findmi-600"
                }`}
              >
                {page.is_published ? "Unpublish" : "Publish"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Page Details */}
      <div className="mt-6 rounded-2xl border border-black/10 bg-white p-4">
        <p className="font-display text-sm font-semibold tracking-tight text-ink">Page Details</p>
        {page.is_system ? (
          <p className="mt-1 text-xs text-ink/45">
            System page — route <code className="rounded bg-black/5 px-1 py-0.5">/</code>, always published,
            can&rsquo;t be deleted or moved off its route.
          </p>
        ) : (
          <p className="mt-1 text-xs text-ink/45">Saving never publishes or unpublishes — use Publish / Unpublish above.</p>
        )}

        <form action={saveDiscoveryPage.bind(null, page.id, page.is_system)} className="mt-3 flex flex-col gap-3">
          <TextField label="Internal Name" name="internal_name" defaultValue={page.internal_name} required hint="Only shown in Admin." />
          <TextField label="Title" name="title" defaultValue={page.title} required />
          <TextareaField label="Description" name="description" defaultValue={page.description} rows={3} />

          {page.is_system ? (
            <p className="rounded-xl border border-black/10 bg-black/[0.02] px-3.5 py-3 text-xs text-ink/50">
              Slug and publication aren&rsquo;t editable for the system Homepage page.
            </p>
          ) : (
            <>
              <TextField label="Slug" name="slug" defaultValue={page.slug} hint={`Public address: ${guidePath(page.slug)}`} />

              <p className="mt-2 text-xs font-bold uppercase tracking-wide text-ink/40">Hero</p>
              <ImageField label="Hero Image" name="hero_image_url" defaultValue={page.hero_image_url} />
              <TextField label="Hero Image Alt Text" name="hero_image_alt" defaultValue={page.hero_image_alt} hint="Describes the image for screen readers." />
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label="CTA Label" name="cta_label" defaultValue={page.cta_label} placeholder="e.g. Get Race Info" />
                <TextField label="CTA Destination" name="cta_url" defaultValue={page.cta_url} placeholder="https://… or /events" hint="https:// link or a Findmi path starting with /." />
              </div>

              <p className="mt-2 text-xs font-bold uppercase tracking-wide text-ink/40">Coverage Dates</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label="Starts" name="starts_on" type="date" defaultValue={page.starts_on} />
                <TextField label="Ends" name="ends_on" type="date" defaultValue={page.ends_on} />
              </div>
              <p className="-mt-1 text-xs text-ink/45">Shown on the Guide. Dates never publish or unpublish it; after the end date it stays public, marked as a past Guide.</p>

              <p className="mt-2 text-xs font-bold uppercase tracking-wide text-ink/40">Search &amp; Sharing</p>
              <TextField label="SEO Title" name="seo_title" defaultValue={page.seo_title} hint="Defaults to the Title." />
              <TextareaField label="SEO Description" name="seo_description" defaultValue={page.seo_description} rows={2} />
              <ImageField label="Share Image" name="og_image_url" defaultValue={page.og_image_url} />
            </>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <TextField label="Category" name="category_slug" defaultValue={page.category_slug} />
            <TextField label="Market" name="market_slug" defaultValue={page.market_slug} />
            <TextField label="Area" name="area_slug" defaultValue={page.area_slug} />
          </div>

          <button
            type="submit"
            className="self-start rounded-full bg-ink px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-ink/85"
          >
            Save Page
          </button>
        </form>

        {!page.is_system && (
          <form action={deleteDiscoveryPage.bind(null, page.id, page.is_system)} className="mt-3">
            <button type="submit" className="text-xs font-semibold text-red-600 hover:underline">
              Delete Page
            </button>
          </form>
        )}
      </div>

      {/* Sections */}
      <p className="mt-8 text-xs font-bold uppercase tracking-wide text-ink/40">Sections</p>

      {topLevel.length === 0 ? (
        <p className="mt-3 text-sm text-ink/45">No sections yet — add one below.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          {topLevel.map((row) => (
            <div key={row.id}>
              {renderSection(row, topLevel, "Top level")}
              {row.section_type === "group" && (childrenByParent.get(row.id)?.length ?? 0) > 0 && (
                <div className="ml-4 mt-2 flex flex-col gap-3 border-l-2 border-black/10 pl-4">
                  {(childrenByParent.get(row.id) ?? []).map((child) =>
                    renderSection(child, childrenByParent.get(row.id) ?? [], `Under: ${row.title}`)
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 rounded-2xl border border-dashed border-black/15 bg-black/[0.015] p-4">
        <p className="text-sm font-semibold text-ink">Add A Section</p>
        <form action={createSection.bind(null, pageId)} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <TextField label="Heading" name="title" placeholder="e.g. Happening This Weekend" />
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">Type</span>
            <select
              name="section_type"
              defaultValue="feed"
              className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink focus:border-ink/30 focus:outline-none sm:w-auto"
            >
              <option value="feed">Feed</option>
              <option value="group">Group</option>
            </select>
          </label>
          <button
            type="submit"
            className="shrink-0 rounded-full bg-ink px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-ink/85"
          >
            + Add Section
          </button>
        </form>
      </div>
    </div>
  );
}
