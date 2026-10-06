import type { Metadata } from "next";
import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getJournalEntryWithRelations } from "@/lib/journal";
import { isAdminSession } from "@/lib/admin/auth";
import { journalAuthorHref, journalByline, resolveJournalAuthorNames } from "@/lib/journal-author";
import JournalOwnerActions from "@/components/journal/JournalOwnerActions";
import JournalPhotoGallery from "@/components/journal/JournalPhotoGallery";
import { JournalMediaViewerRoot, JournalPhotoTrigger } from "@/components/journal/JournalMediaViewer";
import type { MediaViewerItem } from "@/components/MediaViewer";
import ReadMoreText from "@/components/ReadMoreText";
import { formatDateShortInZone, formatTimeRangeInZone } from "@/lib/format";
import { journalSectionLabel } from "@/lib/journal-sections";
import { getRelatedPublicMoments } from "@/lib/journal-distribution";
import MomentsCarousel from "@/components/journal/MomentsCarousel";
import ChevronIcon from "@/components/ChevronIcon";

export const dynamic = "force-dynamic";

/** Journal V1 — the single public (or owner's own) Journal Entry page.
 * ONE route for both cases: getJournalEntryWithRelations reads through the
 * session-scoped client, so RLS alone decides what comes back — the owner
 * sees their own entry regardless of visibility/status, anyone else only a
 * published public one. A private/nonexistent/someone-else's-draft entry
 * is indistinguishable here (both resolve to null -> notFound()), which is
 * the correct, non-leaking behavior. No video, no comments, no reaction
 * counts, no public creator profile — this is the entry itself: photos,
 * the owner's own notes, and the real Findmi objects it's connected to.
 *
 * Visual convergence pass — same data/authorization as before; this file
 * only changes composition: an editorial photo gallery (JournalPhotoGallery)
 * instead of a uniform grid, grouped connected objects, a truthful "Visit
 * Details" section that no longer silently drops a time when there's no
 * Location, and owner controls moved into their own de-emphasized
 * component (JournalOwnerActions).
 *
 * V1.1 — manual-location display (entry.manual_location_* — see the
 * journal_manual_location migration; no new query, these columns already
 * came through getJournalEntryWithRelations' existing `select("*")`) when
 * there's no canonical Location, and the hero title no longer gets
 * line-clamped: this detail hero is the canonical reading view for the
 * entry's own title, unlike an archive card, which may still truncate. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const result = await getJournalEntryWithRelations(id);
  if (!result || result.entry.visibility !== "public") return { title: "Moment" };
  return {
    title: result.entry.title,
    description: result.entry.notes?.slice(0, 160) ?? `A Moment on Findmi${result.location ? ` at ${result.location.name}` : ""}.`,
  };
}

export default async function JournalEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [result, isAuthorizedAdmin] = await Promise.all([getJournalEntryWithRelations(id), isAdminSession()]);
  if (!result) notFound();
  const { entry, media, location, businesses, products, events, occurrences, sections, isOwner } = result;
  // Recovery pass — the byline names the real author (profile display
  // name), not the stale "Findmi" label an admin-cookie capture stamped.
  const authorNames = await resolveJournalAuthorNames([entry.user_id]);
  const authorLabel = journalByline(authorNames.get(entry.user_id), entry.author_label);
  const isPublicEntry = entry.visibility === "public" && entry.status === "published";

  // Journal Experience Date repair — an Event connection's displayed date
  // must be the specific attended Event Occurrence (category B: EVENT
  // OCCURRENCE DATE), never the parent Event's own events.start_at
  // (category C: PARENT EVENT DATE). Only falls back to the Event's own
  // start_at (the old, generic behavior) when no occurrence is connected
  // for that Event — never a guessed/first occurrence.
  const occurrenceForEvent = (eventId: string) => occurrences.find((o) => o.event_id === eventId) ?? null;
  const primaryOccurrence = events.length > 0 ? occurrenceForEvent(events[0].id) : null;
  // Visit Details' time line prefers the connected occurrence's real
  // start–end range (authoritative) over the manually-typed entry_time —
  // available data this pass surfaces without redesigning the section.
  const occurrenceTimeLabel = primaryOccurrence
    ? formatTimeRangeInZone(primaryOccurrence.start_at, primaryOccurrence.end_at, primaryOccurrence.timezone)
    : null;

  const cover = media.find((m) => m.is_cover) ?? media[0] ?? null;

  // Public Moment V2 — the author's photo sections (journal_entry_sections,
  // already loaded in their stored display_order), each with its own
  // photos in their stored display_order. A photo whose section_id points
  // at no loaded section is treated as unsectioned (never dropped). The
  // cover stays in its section when it has one (the section reads
  // complete); unsectioned, it's shown by the hero only — exactly as the
  // flat gallery always treated it.
  const sectionIds = new Set(sections.map((sec) => sec.id));
  const photoSections = sections
    .map((sec) => ({ section: sec, photos: media.filter((m) => m.section_id === sec.id) }))
    .filter((g) => g.photos.length > 0 || Boolean(g.section.notes?.trim()));
  const hasSections = photoSections.length > 0;
  const unsectioned = media.filter((m) => !(m.section_id && sectionIds.has(m.section_id)) && m.id !== cover?.id);

  // Global Media Viewer V1 — ONE viewer for the whole Moment, now in the
  // order the page renders photos (an unsectioned cover first, then each
  // section's photos, then More Photos), so Next from the last photo of
  // one section continues into the next section. Without sections this is
  // exactly the previous display_order order. Only media with a real
  // signed URL can be opened full-screen.
  const renderedOrder = hasSections
    ? [
        ...(cover && !(cover.section_id && sectionIds.has(cover.section_id)) ? [cover] : []),
        ...photoSections.flatMap((g) => g.photos),
        ...unsectioned,
      ]
    : media;
  const viewerItems: MediaViewerItem[] = renderedOrder
    .filter((m): m is typeof m & { url: string } => Boolean(m.url))
    .map((m) => ({ id: m.id, src: m.url, alt: entry.title, caption: m.caption }));
  const viewerIndex = (id: string) => viewerItems.findIndex((v) => v.id === id);
  const toGalleryItems = (list: typeof media) =>
    list.map((m) => ({ id: m.id, url: m.url, caption: m.caption, category: null, mediaIndex: m.url ? viewerIndex(m.id) : -1 }));
  const coverIndex = cover?.url ? viewerItems.findIndex((v) => v.id === cover.id) : -1;
  const dateLabel = new Date(entry.entry_date + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const timeLabel = entry.entry_time
    ? new Date(`${entry.entry_date}T${entry.entry_time}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : null;

  // Public Moment V2 — the ONE primary real-world context, directly under
  // the hero: the linked Event (dated by its connected occurrence when
  // there is one — never the Event's overall range), else the Location,
  // else the Business. It is never repeated as a card further down.
  const primaryEvent = events[0] ?? null;
  const primaryKind: "event" | "location" | "business" | null = primaryEvent
    ? "event"
    : location
      ? "location"
      : businesses.length > 0
        ? "business"
        : null;
  const otherEvents = events.slice(1);
  const otherBusinesses = primaryKind === "business" ? businesses.slice(1) : businesses;
  const eventPlaceName = primaryOccurrence?.location?.name ?? location?.name ?? null;
  const eventWhen = primaryEvent
    ? primaryOccurrence
      ? `${formatDateShortInZone(primaryOccurrence.start_at, primaryOccurrence.timezone)} · ${formatTimeRangeInZone(primaryOccurrence.start_at, primaryOccurrence.end_at, primaryOccurrence.timezone)}`
      : null
    : null;

  // More Findmi Moments — same date -> Event -> Location -> Business.
  const relatedMoments = await getRelatedPublicMoments({
    currentId: entry.id,
    occurrenceId: primaryOccurrence?.id ?? null,
    eventId: primaryEvent?.id ?? null,
    locationId: location?.id ?? null,
    businessId: businesses[0]?.id ?? null,
  });

  // V1.1 — a manual Journal location (no canonical Location row) still
  // gets a truthful name for the hero subtitle and a Directions link when
  // there's genuinely enough address text to form a useful map query.
  // Never fabricated coordinates — just the owner's own typed text, passed
  // straight into the same Google Maps search pattern LocationPublicView
  // already uses.
  const manualLocationName = entry.manual_location_name ?? entry.manual_location_city ?? null;
  const hasManualLocation = Boolean(
    entry.manual_location_name || entry.manual_location_address || entry.manual_location_city || entry.manual_location_state || entry.manual_location_zip
  );
  const manualLocationLine = [
    entry.manual_location_address,
    [entry.manual_location_city, entry.manual_location_state].filter(Boolean).join(", "),
    entry.manual_location_zip,
  ]
    .filter(Boolean)
    .join(" · ");
  const manualHasUsefulAddress = Boolean(entry.manual_location_address || (entry.manual_location_city && entry.manual_location_state));

  const mapsQuery = location
    ? encodeURIComponent([location.name, location.address, [location.city, location.state].filter(Boolean).join(", ")].filter(Boolean).join(", "))
    : !location && hasManualLocation && manualHasUsefulAddress
      ? encodeURIComponent(
          [entry.manual_location_name, entry.manual_location_address, [entry.manual_location_city, entry.manual_location_state].filter(Boolean).join(", ")]
            .filter(Boolean)
            .join(", ")
        )
      : null;
  const directionsHref = mapsQuery ? `https://www.google.com/maps/search/?api=1&query=${mapsQuery}` : null;

  const heroLocationLabel = location?.name ?? manualLocationName;

  const pageBody = (
    <>
      {/* Hero */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-ink sm:rounded-b-3xl">
        {cover?.url ? (
          <JournalPhotoTrigger index={coverIndex} label={`View photo${media.length === 1 ? "" : "s"}`} className="absolute inset-0 h-full w-full">
            <Image src={cover.url} alt={entry.title} fill unoptimized priority sizes="(min-width: 768px) 672px, 100vw" className="object-cover" />
          </JournalPhotoTrigger>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-ink">
            <span className="text-label uppercase tracking-wide text-white/25">Findmi</span>
          </div>
        )}
        {/* Journal Pass 1 — authorized-admin-only edit control. Same glass
            icon-button treatment every other photo-overlay action in this
            app already uses (e.g. HomeEventCard's Calendar/Share buttons),
            not a new visual language. isAdminSession() is the same
            independent cookie-session check /admin's own middleware gate
            performs — server-verified, never a client-side role guess.
            Links straight to this entry's own admin editor, never a
            generic Journal admin index. */}
        {isAuthorizedAdmin && (
          <Link
            href={`/admin/journal/${entry.id}`}
            aria-label="Edit Moment"
            className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur-md transition active:scale-95"
          >
            <EditPencilGlyph className="h-4 w-4" />
          </Link>
        )}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1 p-4 pt-16 sm:p-6"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.6) 35%, rgba(0,0,0,0) 85%)" }}
        >
          <p className="text-[10px] font-bold uppercase tracking-wide text-white/60">Moment</p>
          {/* V1.1 — the detail hero is the canonical reading view for this
              title; unlike an archive card, it never line-clamps it away.
              Natural wrapping + the gradient's own generous bottom padding
              keep even a long title readable. */}
          <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">{entry.title}</h1>
          {/* Author attribution — links to the author's public Journal
              (public entries only). Never an empty byline row. */}
          {authorLabel &&
            (isPublicEntry ? (
              <p className="text-xs font-semibold uppercase tracking-wide text-white/70">
                <Link href={journalAuthorHref(entry.id)} className="pointer-events-auto underline-offset-2 hover:text-white hover:underline">
                  By {authorLabel}
                </Link>
              </p>
            ) : (
              <p className="text-xs font-semibold uppercase tracking-wide text-white/70">By {authorLabel}</p>
            ))}
          <p className="text-sm font-medium text-white/80">
            {dateLabel}
            {heroLocationLabel ? ` · ${heroLocationLabel}` : ""}
          </p>
          {media.length > 0 && (
            <p className="text-xs text-white/60">
              {media.length} photo{media.length === 1 ? "" : "s"}
            </p>
          )}
        </div>
      </div>

      <div className="px-4 sm:px-0">
        {isOwner && (
          <div className="mt-4">
            <JournalOwnerActions entryId={entry.id} visibility={entry.visibility} status={entry.status} />
          </div>
        )}

        {/* Public Moment V2 — the primary experience context, before any
            photos: "what real-world experience was this?" */}
        {primaryKind === "event" && primaryEvent && (
          <div className="mt-4">
            <ContextCard
              href={`/event/${primaryEvent.slug}`}
              kicker="Event"
              imageUrl={primaryEvent.cover_image_url}
              title={primaryEvent.name}
              lines={[eventWhen, eventPlaceName]}
              action="View Event"
            />
          </div>
        )}
        {primaryKind === "location" && location && (
          <div className="mt-4">
            <ContextCard
              href={`/location/${location.slug}`}
              kicker="Location"
              imageUrl={location.logo_url ?? location.cover_image_url}
              title={location.name}
              lines={[[location.address, [location.city, location.state].filter(Boolean).join(", ")].filter(Boolean).join(", ") || null]}
              action="View Location"
            />
          </div>
        )}
        {primaryKind === "business" && businesses[0] && (
          <div className="mt-4">
            <ContextCard href={`/business/${businesses[0].slug}`} kicker="Business" imageUrl={businesses[0].logo_url} title={businesses[0].name} lines={[]} action="View Business" />
          </div>
        )}

        {/* The author's overall story — plain, restrained text. */}
        {entry.notes && (
          <div className="mt-5 max-w-xl">
            <ReadMoreText text={entry.notes} />
          </div>
        )}

        {hasSections ? (
          <>
            {photoSections.map(({ section, photos }) => (
              <section key={section.id} className="mt-8">
                <h2 className="font-display text-lg font-bold tracking-tight text-ink">{journalSectionLabel(section)}</h2>
                {section.notes?.trim() && <p className="mt-1.5 max-w-xl whitespace-pre-line text-sm leading-relaxed text-ink/70">{section.notes.trim()}</p>}
                {photos.length > 0 && (
                  <div className="mt-3">
                    <JournalPhotoGallery items={toGalleryItems(photos)} />
                  </div>
                )}
              </section>
            ))}
            {unsectioned.length > 0 && (
              <section className="mt-8">
                <h2 className="font-display text-lg font-bold tracking-tight text-ink">More Photos</h2>
                <div className="mt-3">
                  <JournalPhotoGallery items={toGalleryItems(unsectioned)} />
                </div>
              </section>
            )}
          </>
        ) : (
          unsectioned.length > 0 && (
            <section className="mt-6">
              <JournalPhotoGallery items={toGalleryItems(unsectioned)} />
            </section>
          )
        )}

        {/* Visit Details — where/when, plus whatever else is connected
            (never the primary context card again). */}
        {(location || hasManualLocation || timeLabel || occurrenceTimeLabel || otherBusinesses.length > 0 || products.length > 0 || otherEvents.length > 0) && (
          <section className="mt-10">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink">Visit Details</h2>
            <div className="mt-3 flex flex-col gap-2">
              <p className="text-sm text-ink/70">
                {dateLabel}
                {occurrenceTimeLabel ? ` · ${occurrenceTimeLabel}` : timeLabel ? ` · ${timeLabel}` : ""}
              </p>
              {location && primaryKind !== "location" && (
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <ConnectedRow href={`/location/${location.slug}`} imageUrl={location.logo_url ?? location.cover_image_url} name={location.name} meta={[location.city, location.state].filter(Boolean).join(", ")} />
                  </div>
                  {directionsHref && (
                    <a
                      href={directionsHref}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-10 shrink-0 items-center justify-center rounded-lg border border-findmi/40 px-3 text-xs font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-findmi-50"
                    >
                      Directions
                    </a>
                  )}
                </div>
              )}
              {/* V1.1 — no canonical Location, but the owner typed a real
                  place: show exactly what they entered (never a fabricated
                  Location-style card/link, since this place doesn't exist
                  as one). Directions only renders when there's genuinely
                  enough address text to form a useful map query. */}
              {!location && hasManualLocation && (
                <div className="flex items-center gap-2 rounded-xl border border-black/5 bg-white p-2.5">
                  <div className="min-w-0 flex-1">
                    {manualLocationName && <p className="truncate text-sm font-semibold text-ink">{manualLocationName}</p>}
                    {manualLocationLine && <p className="truncate text-xs text-ink/50">{manualLocationLine}</p>}
                  </div>
                  {directionsHref && (
                    <a
                      href={directionsHref}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-10 shrink-0 items-center justify-center rounded-lg border border-findmi/40 px-3 text-xs font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-findmi-50"
                    >
                      Directions
                    </a>
                  )}
                </div>
              )}
              {/* Location is the primary context card above — keep just
                  its Directions here rather than a second Location row. */}
              {location && primaryKind === "location" && directionsHref && (
                <a
                  href={directionsHref}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-10 w-fit items-center justify-center rounded-lg border border-findmi/40 px-3 text-xs font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-findmi-50"
                >
                  Directions
                </a>
              )}
              {(otherBusinesses.length > 0 || products.length > 0 || otherEvents.length > 0) && (
                <div className="mt-2 flex flex-col gap-4">
                  {otherEvents.length > 0 && (
                    <ConnectedGroup label="Also Connected">
                      {otherEvents.map((e) => {
                        const occ = occurrenceForEvent(e.id);
                        const meta = occ
                          ? `${formatDateShortInZone(occ.start_at, occ.timezone)} · ${formatTimeRangeInZone(occ.start_at, occ.end_at, occ.timezone)}`
                          : undefined;
                        return <ConnectedRow key={`event-${e.id}`} href={`/event/${e.slug}`} imageUrl={e.cover_image_url} name={e.name} meta={meta} />;
                      })}
                    </ConnectedGroup>
                  )}
                  {otherBusinesses.length > 0 && (
                    <ConnectedGroup label="Businesses">
                      {otherBusinesses.map((b) => (
                        <ConnectedRow key={`business-${b.id}`} href={`/business/${b.slug}`} imageUrl={b.logo_url} name={b.name} />
                      ))}
                    </ConnectedGroup>
                  )}
                  {products.length > 0 && (
                    <ConnectedGroup label="Products">
                      {products.map((p) => (
                        <ConnectedRow key={`product-${p.id}`} href={`/product/${p.slug}`} imageUrl={p.image_url} name={p.name} meta={p.business?.name} />
                      ))}
                    </ConnectedGroup>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* More Findmi Moments — other public Moments from this same
            experience (date -> Event -> Location -> Business); hidden
            entirely when none qualify. */}
        {relatedMoments.length > 0 && (
          <section className="mt-10">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink">More Findmi Moments</h2>
            <div className="mt-3">
              <MomentsCarousel entries={relatedMoments} total={null} viewAllHref="/journal" />
            </div>
          </section>
        )}
      </div>
    </>
  );

  return (
    <div className="mx-auto max-w-2xl pb-14">
      {/* Global Media Viewer V1 — only instantiated when there's real,
          openable media; a zero-photo entry gets no viewer at all (see
          this pass's own requirement on that). */}
      {viewerItems.length > 0 ? <JournalMediaViewerRoot items={viewerItems}>{pageBody}</JournalMediaViewerRoot> : pageBody}
    </div>
  );
}

/** Public Moment V2 — the compact primary-context card under the hero:
 * thumbnail, kicker, name, up to two real detail lines, and a clear
 * action. The whole card is the link. */
function ContextCard({
  href,
  kicker,
  imageUrl,
  title,
  lines,
  action,
}: {
  href: string;
  kicker: string;
  imageUrl: string | null;
  title: string;
  lines: (string | null)[];
  action: string;
}) {
  const shown = lines.filter((l): l is string => Boolean(l));
  return (
    <Link href={href} className="flex items-center gap-3 rounded-2xl border border-black/[0.06] bg-white p-3 shadow-sm transition hover:border-black/10">
      <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-mist">
        {imageUrl && <Image src={imageUrl} alt="" fill unoptimized sizes="64px" className="object-cover" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-bold uppercase tracking-wide text-findmi-700">{kicker}</span>
        <span className="mt-0.5 block font-display text-base font-bold leading-snug tracking-tight text-ink">{title}</span>
        {shown.map((l) => (
          <span key={l} className="mt-0.5 block text-sm leading-snug text-ink/60">
            {l}
          </span>
        ))}
        <span className="mt-1 inline-flex items-center gap-0.5 text-sm font-semibold text-findmi-700">
          {action}
          <ChevronIcon direction="right" className="h-3.5 w-3.5" />
        </span>
      </span>
    </Link>
  );
}

function ConnectedGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink/40">{label}</p>
      <div className="flex flex-col gap-2">{children}</div>
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

// Journal Pass 1 — this file's own local glyph (no SVG helper previously
// existed here), same plain stroke-icon convention used throughout the
// app (e.g. page.tsx's own ChevronGlyph/PlusBadgeGlyph on the homepage).
function EditPencilGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M17 3a2.1 2.1 0 013 3L8.5 17.5 4 19l1.5-4.5L17 3z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
