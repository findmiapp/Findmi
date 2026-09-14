import Link from "next/link";
import { TextField, TextareaField } from "@/components/admin/Fields";
import { getAdminDiscoveryPages } from "@/lib/discovery-pages";
import { createDiscoveryPage } from "./actions";

export const dynamic = "force-dynamic";

/** Discovery Pages — Phase 1 list. Every page the founder can configure,
 * Homepage (the reserved system page) always first. Creating a page here
 * always starts it unpublished (see createDiscoveryPage) — it has no
 * public route in Phase 1, so this is purely a configuration surface;
 * Phase 3 is expected to wire publishing to a real public URL. */
export default async function DiscoveryPagesListPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const pages = await getAdminDiscoveryPages();

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-ink/45">
        <Link href="/admin/site" className="hover:underline">
          Site Editor
        </Link>
        <span>/</span>
        <span>Discovery Pages</span>
      </div>
      <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">Discovery Pages</h1>
      <p className="mt-1 max-w-xl text-sm text-ink/50">
        The canonical Page + Section foundation (Phase 1). Homepage is the reserved system page — it
        always renders at <code className="rounded bg-black/5 px-1 py-0.5">/</code> and can&rsquo;t be
        unpublished or deleted. Any other page you create here starts unpublished — it has no public
        route yet.
      </p>

      {error && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          {saved === "created" ? "Page created — configure it below." : "Saved."}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-2">
        {pages.map((p) => (
          <Link
            key={p.id}
            href={`/admin/site/pages/${p.id}`}
            className="flex items-center justify-between gap-3 rounded-xl border border-black/5 bg-white px-4 py-3 transition hover:border-black/10"
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-ink">{p.internal_name}</span>
                {p.is_system && (
                  <span className="shrink-0 rounded-full bg-ink/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink/60">
                    System
                  </span>
                )}
                {!p.is_system && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      p.is_published ? "bg-findmi-50 text-findmi-700" : "bg-black/5 text-ink/45"
                    }`}
                  >
                    {p.is_published ? "Published" : "Unpublished"}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block truncate text-xs text-ink/45">
                {p.is_system ? "Route: /" : `Internal slug: ${p.slug} (no public route yet)`}
              </span>
            </span>
            <span className="shrink-0 text-ink/30">→</span>
          </Link>
        ))}
      </div>

      <div className="mt-8 rounded-2xl border border-dashed border-black/15 bg-black/[0.015] p-4">
        <p className="text-sm font-semibold text-ink">Create a page</p>
        <p className="mt-1 text-xs text-ink/45">
          Starts unpublished, for configuring and verifying sections before anything is public.
        </p>
        <form action={createDiscoveryPage} className="mt-3 flex flex-col gap-3">
          <TextField label="Internal name" name="internal_name" placeholder="e.g. Food Trucks Test Page" required />
          <TextField label="Public title (optional)" name="title" placeholder="Defaults to the internal name" />
          <TextField
            label="Slug (optional)"
            name="slug"
            placeholder="Defaults from the internal name"
            hint="Internal identifier only in Phase 1 — no public route reads it yet."
          />
          <TextareaField label="Description (optional)" name="description" rows={2} />
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField label="Category (optional)" name="category_slug" placeholder="e.g. food-trucks" />
            <TextField label="Market (optional)" name="market_slug" />
            <TextField label="Area (optional)" name="area_slug" />
          </div>
          <button
            type="submit"
            className="self-start rounded-full bg-ink px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-ink/85"
          >
            + Create Page
          </button>
        </form>
      </div>
    </div>
  );
}
