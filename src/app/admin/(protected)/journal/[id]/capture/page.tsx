import Link from "next/link";
import { notFound } from "next/navigation";
import { getJournalEntryWithRelationsForAdmin } from "@/lib/journal";
import JournalCapturePhotos from "@/components/journal/JournalCapturePhotos";
import JournalQuickNote from "@/components/journal/JournalQuickNote";

export const dynamic = "force-dynamic";

/** Journal Live Capture pass — the lightweight mobile surface a founder
 * lands on after tapping "Document this experience" on an Event page (or
 * on returning to the same draft). Deliberately NOT another full editor:
 * it operates on the exact same journal_entries record/media/actions the
 * full editor (JournalEditForm, reused unchanged by /admin/journal/[id])
 * already uses — no SEO/slug/title setup required before capturing, no
 * section organization, just Add Photos + one Quick Note + the already-
 * resolved context, with a direct link into the full editor for anyone
 * who wants to do more right now. Already behind the standard /admin
 * middleware gate, same as /admin/journal/[id] itself — no additional
 * in-page admin check needed (same convention that page's own comment
 * documents). Data loads through the same admin (service-role) read
 * already built for Pass 1, so this works regardless of who created the
 * draft or its current status. */
export default async function JournalCapturePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getJournalEntryWithRelationsForAdmin(id);
  if (!result) notFound();
  const { entry, media, location, businesses, events } = result;

  const dateLabel = new Date(entry.entry_date + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const event = events[0] ?? null;
  const business = businesses[0] ?? null;

  return (
    <div className="mx-auto max-w-md px-4 py-5">
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Journal Draft</p>
      <h1 className="mt-1 font-display text-xl font-bold tracking-tight text-ink">{entry.title}</h1>

      {/* Journal Live Capture pass — context should be useful, not just
          decorative: wherever a canonical FindMi public route already
          exists for the connected event/business/location, it's a real
          link, reusing those exact existing routes — no new entity-link
          framework. A relationship that didn't resolve deterministically
          (e.g. an ambiguous business) simply doesn't render here rather
          than guessing or blocking capture. */}
      {(event || business || location) && (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-ink/60">
          {event && (
            <Link href={`/event/${event.slug}`} className="font-semibold text-findmi-700 hover:underline">
              {event.name}
            </Link>
          )}
          {business && (
            <>
              {event && <span className="text-ink/30">·</span>}
              <Link href={`/business/${business.slug}`} className="font-semibold text-findmi-700 hover:underline">
                {business.name}
              </Link>
            </>
          )}
          {location && (
            <>
              {(event || business) && <span className="text-ink/30">·</span>}
              <Link href={`/location/${location.slug}`} className="font-semibold text-findmi-700 hover:underline">
                {location.name}
              </Link>
            </>
          )}
        </p>
      )}
      <p className="mt-0.5 text-xs text-ink/50">{dateLabel}</p>

      <div className="mt-5">
        <JournalCapturePhotos
          entryId={entry.id}
          initialPhotos={media.map((m) => ({ id: m.id, url: m.url ?? "", isCover: m.is_cover }))}
        />
      </div>

      <div className="mt-5">
        <JournalQuickNote
          entryId={entry.id}
          title={entry.title}
          entryDate={entry.entry_date}
          entryTime={entry.entry_time}
          initialNotes={entry.notes ?? ""}
        />
      </div>

      <div className="mt-6 flex items-center justify-between gap-3 border-t border-black/5 pt-4">
        <span className="rounded-full bg-black/[0.04] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-ink/50">
          {entry.status === "published" ? "Published" : "Draft"}
        </span>
        <Link
          href={`/admin/journal/${entry.id}`}
          className="flex h-10 items-center justify-center rounded-xl bg-ink px-4 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-ink/90"
        >
          Continue Editing
        </Link>
      </div>
    </div>
  );
}
