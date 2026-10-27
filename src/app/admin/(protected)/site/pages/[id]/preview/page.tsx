import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import GuideView, { resolveGuide } from "@/components/guides/GuideView";
import { getAdminDiscoveryPage } from "@/lib/discovery-pages";
import { buildGuideSections, getGuideSectionRows, guidePath } from "@/lib/guides";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { todayIn } from "@/lib/event-time";

// Pages + Sections V1A — Admin-only Guide preview (drafts included). Behind
// the /admin middleware gate; reads the Page and its visible Sections with
// the service-role client and renders the SAME GuideView the public
// /guides/[slug] route renders, so the preview never drifts from the live
// Page. Never indexed.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Guide Preview", robots: { index: false, follow: false } };

export default async function GuidePreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await getAdminDiscoveryPage(id);
  if (!page) notFound();
  const editorHref = `/admin/site/pages/${page.id}`;

  if (page.is_system) {
    return (
      <div className="rounded-2xl border border-black/10 bg-white p-4 text-sm text-ink/60">
        The Homepage is a system page and isn&rsquo;t a Guide — it renders at{" "}
        <Link href="/" className="font-semibold text-findmi-700 hover:underline">
          /
        </Link>
        .{" "}
        <Link href={editorHref} className="font-semibold text-findmi-700 hover:underline">
          Back To Page Editor
        </Link>
      </div>
    );
  }

  const rows = await getGuideSectionRows(page.id, getAdminSupabase());
  const { sections } = await resolveGuide(page, buildGuideSections(rows));
  return (
    <div>
      {/* Pages + Sections V1B — one compact line (was a tall wrapped block
          on mobile): preview state, public link when published, back. */}
      <div className="sticky top-0 z-30 -mx-4 mb-2 flex items-center justify-between gap-2 border-b border-amber-200 bg-amber-50/95 px-4 py-1.5 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <p className="min-w-0 truncate text-xs font-bold text-amber-900">{page.is_published ? "Admin Preview · Published" : "Draft Preview · Not Public"}</p>
        <div className="flex shrink-0 items-center gap-1">
          {page.is_published && (
            <Link href={guidePath(page.slug)} className="inline-flex min-h-9 items-center px-2 text-xs font-semibold text-amber-900 underline underline-offset-2">
              Public Page
            </Link>
          )}
          <Link href={editorHref} className="inline-flex min-h-9 items-center rounded-full bg-ink px-3 text-[11px] font-bold uppercase tracking-wide text-white">
            Back To Editor
          </Link>
        </div>
      </div>
      <div className="-mx-4 sm:-mx-6 lg:-mx-8">
        <GuideView page={page} sections={sections} today={todayIn()} />
      </div>
    </div>
  );
}
