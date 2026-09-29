import Link from "next/link";
import { TextField } from "@/components/admin/Fields";
import { getAdminBulletins } from "@/lib/homepage-bulletins";
import { createBulletin } from "./actions";

export const dynamic = "force-dynamic";

function formatUpdatedAt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Homepage Bulletins — admin list. Multiple Bulletins can be saved; at
 * most one is ever published on the homepage at a time (see actions.ts's
 * publishBulletin) — the badge below is this list's only source of truth
 * for which one that is. Creating one here only requires a headline
 * (same "create with the one required field, configure the rest on the
 * editor" pattern Discovery Pages already uses) and starts unpublished. */
export default async function BulletinsListPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const bulletins = await getAdminBulletins();

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-ink/45">
        <Link href="/admin/site" className="hover:underline">
          Site Editor
        </Link>
        <span>/</span>
        <span>Homepage Bulletins</span>
      </div>
      <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">Homepage Bulletins</h1>
      <p className="mt-1 max-w-xl text-sm text-ink/50">
        A single editorial announcement shown on the homepage between the hero and What&rsquo;s Coming Up. At most one
        Bulletin can be published at a time — publishing another one automatically unpublishes this one.
      </p>

      {error && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {saved === "created" && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Bulletin created — configure it below.
        </p>
      )}

      <div className="mt-6 flex flex-col gap-2">
        {bulletins.length === 0 && <p className="text-sm text-ink/45">No Bulletins yet — create one below.</p>}
        {bulletins.map((b) => (
          <Link
            key={b.id}
            href={`/admin/bulletins/${b.id}`}
            className="flex items-center gap-3 rounded-xl border border-black/5 bg-white px-4 py-3 transition hover:border-black/10"
          >
            {b.thumbnail_url ? (
              // Admin list thumbnail — arbitrary/mid-edit Storage URL,
              // same reasoning as ImageField's own preview: not worth
              // next/image's remote-host allowlist for a small list icon.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={b.thumbnail_url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="h-10 w-10 shrink-0 rounded-lg bg-black/5" />
            )}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                {b.eyebrow && <span className="truncate text-xs font-bold uppercase tracking-wide text-findmi-700">{b.eyebrow}</span>}
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    b.is_published ? "bg-findmi-50 text-findmi-700" : "bg-black/5 text-ink/45"
                  }`}
                >
                  {b.is_published ? "Published" : "Unpublished"}
                </span>
              </span>
              <span className="mt-0.5 block truncate text-sm font-semibold text-ink">{b.headline}</span>
              <span className="mt-0.5 block text-xs text-ink/45">Updated {formatUpdatedAt(b.updated_at)}</span>
            </span>
            <span className="shrink-0 text-ink/30">→</span>
          </Link>
        ))}
      </div>

      <div className="mt-8 rounded-2xl border border-dashed border-black/15 bg-black/[0.015] p-4">
        <p className="text-sm font-semibold text-ink">Create a Bulletin</p>
        <p className="mt-1 text-xs text-ink/45">Starts unpublished — configure and preview it on the next screen.</p>
        <form action={createBulletin} className="mt-3 flex flex-col gap-3">
          <TextField label="Headline" name="headline" placeholder="e.g. illy's Cup of Love is coming to Hudson Yards" required />
          <button
            type="submit"
            className="self-start rounded-full bg-ink px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-ink/85"
          >
            + Create Bulletin
          </button>
        </form>
      </div>
    </div>
  );
}
