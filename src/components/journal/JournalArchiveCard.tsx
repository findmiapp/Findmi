import Link from "next/link";
import Image from "next/image";
import type { JournalIndexEntry } from "@/lib/journal";

/** Journal V1.1 — the archive's own richer card (replacing the old
 * Index's small square gallery tile): a large cover image leads, title
 * gets real room (still line-clamped here — unlike the Detail hero, a
 * list card legitimately needs to stay compact), then a location line and
 * a truthful meta line built only from real data (photo count, and which
 * connection TYPES exist — never a fabricated per-type count the schema
 * doesn't track). Works unmodified whether the entry has no cover, one
 * photo, many photos, no location, a canonical or manual location, or
 * zero/one/many connected objects. */
export default function JournalArchiveCard({ entry }: { entry: JournalIndexEntry }) {
  const connectionLabels = [entry.hasBusiness ? "Business" : null, entry.hasProduct ? "Product" : null, entry.hasEvent ? "Event" : null].filter(
    (v): v is string => Boolean(v)
  );
  const metaParts = [
    entry.photoCount > 0 ? `${entry.photoCount} photo${entry.photoCount === 1 ? "" : "s"}` : null,
    connectionLabels.length > 0 ? connectionLabels.join(", ") : null,
  ].filter((v): v is string => Boolean(v));

  return (
    <Link
      href={`/journal/${entry.id}`}
      className="flex overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm transition active:scale-[0.99] hover:border-black/10 hover:shadow"
    >
      <div className="relative h-24 w-24 shrink-0 overflow-hidden bg-mist sm:h-28 sm:w-28">
        {entry.coverUrl ? (
          <Image src={entry.coverUrl} alt="" fill unoptimized sizes="112px" className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-ink">
            <span className="text-[9px] font-bold uppercase tracking-wide text-white/25">Findmi</span>
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-2 font-display text-sm font-semibold leading-snug text-ink">{entry.title}</p>
          {entry.visibility === "private" && (
            <span className="mt-0.5 shrink-0 rounded-full bg-black/[0.06] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ink/50">Private</span>
          )}
        </div>
        {entry.location && <p className="truncate text-xs text-ink/55">{entry.location.name}</p>}
        {metaParts.length > 0 && <p className="truncate text-xs text-ink/45">{metaParts.join(" · ")}</p>}
      </div>
    </Link>
  );
}
