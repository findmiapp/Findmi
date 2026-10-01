import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getJournalEntryWithRelations } from "@/lib/journal";
import JournalOwnerActions from "@/components/journal/JournalOwnerActions";

export const dynamic = "force-dynamic";

/** Journal V1 — the single public (or owner's own) Journal Entry page.
 * ONE route for both cases: getJournalEntryWithRelations reads through the
 * session-scoped client, so RLS alone decides what comes back — the owner
 * sees their own entry regardless of visibility/status, anyone else only a
 * published public one. A private/nonexistent/someone-else's-draft entry
 * is indistinguishable here (both resolve to null -> notFound()), which is
 * the correct, non-leaking behavior. No video, no comments, no reaction
 * counts, no public creator profile — this is the entry itself: photos,
 * the owner's own notes, and the real Findmi objects it's connected to. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const result = await getJournalEntryWithRelations(id);
  if (!result || result.entry.visibility !== "public") return { title: "Journal Entry" };
  return {
    title: result.entry.title,
    description: result.entry.notes?.slice(0, 160) ?? `A Journal Entry on Findmi${result.location ? ` at ${result.location.name}` : ""}.`,
  };
}

export default async function JournalEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getJournalEntryWithRelations(id);
  if (!result) notFound();
  const { entry, media, location, businesses, products, events, isOwner } = result;

  const cover = media.find((m) => m.is_cover) ?? media[0] ?? null;
  const gallery = media.filter((m) => m.id !== cover?.id);
  const dateLabel = new Date(entry.entry_date + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const timeLabel = entry.entry_time
    ? new Date(`${entry.entry_date}T${entry.entry_time}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : null;

  const connectedCount = businesses.length + products.length + events.length;
  const connectionsHeading = events.length > 0 ? "Connected to This Experience" : "Places, Brands & Products";

  return (
    <div className="mx-auto max-w-2xl pb-14">
      {/* Hero */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-ink sm:rounded-b-3xl">
        {cover?.url ? (
          <Image src={cover.url} alt={entry.title} fill unoptimized priority sizes="(min-width: 768px) 672px, 100vw" className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-ink">
            <span className="text-label uppercase tracking-wide text-white/25">Findmi</span>
          </div>
        )}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1 p-4 pt-20 sm:p-6"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.6) 35%, rgba(0,0,0,0) 85%)" }}
        >
          <p className="text-[10px] font-bold uppercase tracking-wide text-white/60">Journal Entry</p>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">{entry.title}</h1>
          <p className="text-sm font-medium text-white/80">
            {dateLabel}
            {location ? ` · ${location.name}` : ""}
          </p>
          {media.length > 0 && <p className="text-xs text-white/60">{media.length} photo{media.length === 1 ? "" : "s"}</p>}
        </div>
      </div>

      <div className="px-4 sm:px-0">
        {isOwner && (
          <div className="mt-4">
            <JournalOwnerActions entryId={entry.id} visibility={entry.visibility} />
          </div>
        )}

        {entry.notes && (
          <section className="mt-6 max-w-xl">
            <p className="whitespace-pre-line text-sm leading-relaxed text-ink/80">{entry.notes}</p>
          </section>
        )}

        {gallery.length > 0 && (
          <section className="mt-6">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {gallery.map((m) => (
                <div key={m.id} className="relative aspect-square overflow-hidden rounded-xl bg-mist">
                  {m.url && <Image src={m.url} alt={m.caption ?? ""} fill unoptimized sizes="(min-width: 640px) 33vw, 50vw" className="object-cover" />}
                </div>
              ))}
            </div>
          </section>
        )}

        {connectedCount > 0 && (
          <section className="mt-8">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink">{connectionsHeading}</h2>
            <div className="mt-3 flex flex-col gap-2">
              {businesses.map((b) => (
                <ConnectedRow key={`business-${b.id}`} href={`/business/${b.slug}`} imageUrl={b.logo_url} name={b.name} meta="Business" />
              ))}
              {products.map((p) => (
                <ConnectedRow
                  key={`product-${p.id}`}
                  href={`/product/${p.slug}`}
                  imageUrl={p.image_url}
                  name={p.name}
                  meta={p.business?.name ?? "Product"}
                />
              ))}
              {events.map((e) => (
                <ConnectedRow
                  key={`event-${e.id}`}
                  href={`/event/${e.slug}`}
                  imageUrl={e.cover_image_url}
                  name={e.name}
                  meta={new Date(e.start_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                />
              ))}
            </div>
          </section>
        )}

        {location && (
          <section className="mt-8">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink">Details</h2>
            <div className="mt-3 flex flex-col gap-1 text-sm text-ink/70">
              <p>{dateLabel}{timeLabel ? ` · ${timeLabel}` : ""}</p>
              <ConnectedRow href={`/location/${location.slug}`} imageUrl={location.logo_url ?? location.cover_image_url} name={location.name} meta={[location.city, location.state].filter(Boolean).join(", ")} />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function ConnectedRow({ href, imageUrl, name, meta }: { href: string; imageUrl: string | null; name: string; meta?: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-xl border border-black/5 bg-white p-2.5 transition hover:border-black/10 hover:bg-findmi-50/40">
      <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-black/5">
        {imageUrl && <Image src={imageUrl} alt="" fill unoptimized sizes="40px" className="object-cover" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">{name}</span>
        {meta && <span className="block truncate text-xs text-ink/50">{meta}</span>}
      </span>
      <span className="shrink-0 text-xs font-semibold text-findmi-700">View</span>
    </Link>
  );
}
