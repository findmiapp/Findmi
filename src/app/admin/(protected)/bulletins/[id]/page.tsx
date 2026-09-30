import Link from "next/link";
import { notFound } from "next/navigation";
import BulletinForm from "@/components/admin/BulletinForm";
import {
  getAdminBulletin,
  getBulletinDestinationPreview,
  resolveBulletinPreviewHref,
} from "@/lib/homepage-bulletins";
import { publishBulletin, saveBulletin, unpublishBulletin } from "../actions";

export const dynamic = "force-dynamic";

export default async function BulletinEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { id } = await params;
  const { saved, error } = await searchParams;

  const bulletin = await getAdminBulletin(id);
  if (!bulletin) notFound();

  const [initialDestination, previewHref] = await Promise.all([
    getBulletinDestinationPreview(bulletin.destination_type, bulletin.destination_id),
    resolveBulletinPreviewHref(bulletin),
  ]);

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-ink/45">
        <Link href="/admin/bulletins" className="hover:underline">
          Homepage Bulletins
        </Link>
        <span>/</span>
        <span>{bulletin.headline}</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">{bulletin.headline}</h1>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            bulletin.is_published ? "bg-findmi-50 text-findmi-700" : "bg-black/5 text-ink/45"
          }`}
        >
          {bulletin.is_published ? "Published" : "Hidden"}
        </span>
      </div>

      {error && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          {saved === "published"
            ? "Published — this Bulletin is now live on the homepage."
            : saved === "unpublished"
              ? "Hidden — this Bulletin no longer appears on the homepage."
              : "Saved."}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        {bulletin.is_published ? (
          <form action={unpublishBulletin.bind(null, bulletin.id)}>
            <button
              type="submit"
              className="rounded-full border border-black/10 px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30"
            >
              Unpublish
            </button>
          </form>
        ) : (
          <form action={publishBulletin.bind(null, bulletin.id)}>
            <button
              type="submit"
              className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
            >
              Publish
            </button>
          </form>
        )}
      </div>

      <div className="mt-6">
        <BulletinForm
          bulletin={bulletin}
          initialDestination={initialDestination}
          previewHref={previewHref}
          saveAction={saveBulletin.bind(null, bulletin.id)}
        />
      </div>
    </div>
  );
}
