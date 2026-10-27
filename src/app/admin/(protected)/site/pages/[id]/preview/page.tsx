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
      <div className="sticky top-0 z-30 -mx-4 mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <p className="text-sm font-bold text-amber-900">
          Admin Preview <span className="font-semibold text-amber-800/80">· {page.is_published ? "Published" : "Draft — not public"}</span>
        </p>
        <div className="flex items-center gap-3 text-sm font-semibold">
          {page.is_published && (
            <Link href={guidePath(page.slug)} className="text-amber-900 underline underline-offset-2">
              Open Public Page
            </Link>
          )}
          <Link href={editorHref} className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-white">
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
