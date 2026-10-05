import Link from "next/link";
import { TextField } from "@/components/admin/Fields";
import { getAdminBulletins, type HomepageBulletin } from "@/lib/homepage-bulletins";
import { createBulletin, moveBulletin } from "./actions";
import { ChevronRightGlyph } from "@/components/admin/shell/AdminIcons";

export const dynamic = "force-dynamic";

function formatUpdatedAt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function destinationLabel(b: HomepageBulletin): string | null {
  if (!b.destination_type) return null;
  if (b.destination_type === "custom_url") return "Custom link";
  return b.destination_type[0].toUpperCase() + b.destination_type.slice(1);
}

/** One row, shared by both the Published and Hidden groups below — thumb,
 * eyebrow/headline, destination type, updated date, and Move Up/Down
 * (only meaningful within a row's own carousel-order position, so it acts
 * on the full ordered list actions.ts's moveBulletin already reads). */
function BulletinRow({ b, canMoveUp, canMoveDown }: { b: HomepageBulletin; canMoveUp: boolean; canMoveDown: boolean }) {
  const moveUp = moveBulletin.bind(null, b.id, "up");
  const moveDown = moveBulletin.bind(null, b.id, "down");
  return (
    <div className="flex items-center gap-3 rounded-xl border border-black/5 bg-white px-4 py-3 transition hover:border-black/10">
      <Link href={`/admin/bulletins/${b.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        {b.thumbnail_url ? (
          // Admin list thumbnail — arbitrary/mid-edit Storage URL, same
          // reasoning as ImageField's own preview: not worth next/image's
          // remote-host allowlist for a small list icon.
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
              {b.is_published ? "Published" : "Hidden"}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-sm font-semibold text-ink">{b.headline}</span>
          <span className="mt-0.5 block text-xs text-ink/45">
            {destinationLabel(b) ? `${destinationLabel(b)} · ` : ""}
            Updated {formatUpdatedAt(b.updated_at)}
          </span>
        </span>
      </Link>
      <div className="flex shrink-0 flex-col gap-1">
        <form action={moveUp}>
          <button
            type="submit"
            disabled={!canMoveUp}
            aria-label="Move up"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-black/10 text-ink/50 transition hover:border-black/20 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
          >
            ↑
          </button>
        </form>
        <form action={moveDown}>
          <button
            type="submit"
            disabled={!canMoveDown}
            aria-label="Move down"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-black/10 text-ink/50 transition hover:border-black/20 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
          >
            ↓
          </button>
        </form>
      </div>
      <Link href={`/admin/bulletins/${b.id}`} className="shrink-0 text-ink/30">
        <ChevronRightGlyph className="h-4 w-4" />
      </Link>
    </div>
  );
}

/** Homepage Bulletins — admin list. Homepage Bulletin Carousel pass: any
 * number of Bulletins can be published simultaneously now (the DB no
 * longer enforces "at most one" — see actions.ts's publishBulletin), so
 * this list groups Published (the exact carousel order, top to bottom)
 * from Hidden/Draft, with Move Up/Down controlling display_order. */
export default async function BulletinsListPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const bulletins = await getAdminBulletins();
  // getAdminBulletins already orders is_published desc, display_order asc,
  // created_at desc — the same order moveBulletin's full-list read uses —
  // so slicing here preserves that order inside each group.
  const published = bulletins.filter((b) => b.is_published);
  const hidden = bulletins.filter((b) => !b.is_published);

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
        Editorial announcements shown on the homepage between the hero and What&rsquo;s Coming Up. Any number can be
        published at once — with 2+ published, the homepage rotates them as a carousel in the order below. Use ↑/↓ to
        reorder.
      </p>

      {error && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {saved === "created" && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Bulletin created — configure it below.
        </p>
      )}

      <div className="mt-6">
        <p className="text-xs font-bold uppercase tracking-wide text-ink/45">Published ({published.length})</p>
        <div className="mt-2 flex flex-col gap-2">
          {published.length === 0 && <p className="text-sm text-ink/45">Nothing published — the homepage carousel is empty.</p>}
          {published.map((b, i) => (
            <BulletinRow key={b.id} b={b} canMoveUp={i > 0} canMoveDown={i < published.length - 1} />
          ))}
        </div>
      </div>

      <div className="mt-8">
        <p className="text-xs font-bold uppercase tracking-wide text-ink/45">Hidden ({hidden.length})</p>
        <div className="mt-2 flex flex-col gap-2">
          {hidden.length === 0 && <p className="text-sm text-ink/45">No hidden Bulletins.</p>}
          {hidden.map((b, i) => (
            <BulletinRow key={b.id} b={b} canMoveUp={i > 0} canMoveDown={i < hidden.length - 1} />
          ))}
        </div>
      </div>

      <div className="mt-8 rounded-2xl border border-dashed border-black/15 bg-black/[0.015] p-4">
        <p className="text-sm font-semibold text-ink">Create a Bulletin</p>
        <p className="mt-1 text-xs text-ink/45">Starts hidden — configure and preview it on the next screen.</p>
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
