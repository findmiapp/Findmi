import Link from "next/link";
import LiveDot from "./LiveDot";

/** Premium Featured Event Hero — the shared gradient+text overlay used by
 * both the Event page's own immersive hero (variant the page itself,
 * `compact=false`, `titleTag="h1"`) and the compact Business/Location
 * "Featured Event" teaser card (`compact=true`, `titleTag="h2"`). Purely
 * presentational: the caller supplies the full-bleed image/lightbox or
 * Link wrapper underneath and positions this absolutely over it.
 *
 * Deliberately `pointer-events-none` — every pixel of this overlay,
 * including the text, lets taps fall through to whatever's actually
 * interactive beneath it (the Event page's lightbox trigger, or the
 * single Link wrapping a Business/Location teaser card) so it can never
 * create a second, competing tap target or a nested-interactive-element
 * problem. The one exception is the attribution byline when
 * `attributionHref` is supplied (Event page only — FeaturedEventCard
 * never passes it, since that whole card is already one Link and a
 * second nested one would be invalid): that single element opts back
 * into `pointer-events-auto` to be genuinely tappable. */
export interface FeaturedEventHeroOverlayProps {
  category: string | null;
  title: string;
  /** Rendered as "by {attribution}" — the Event's own featured/primary
   * participating Business (event_businesses.featured), never invented. */
  attribution: string | null;
  /** When provided, the byline becomes a real link to that Business's
   * public profile (Event page hero only). Omitted (default) keeps it
   * plain text — the only safe option inside FeaturedEventCard, which is
   * itself already one whole-card Link. */
  attributionHref?: string;
  /** Pre-resolved copy (e.g. "Happening Now") from the caller's own
   * getTemporalLabel() read — this component never computes or guesses
   * status itself. Null renders no pill at all.
   * Event Top Hierarchy Final Micro-pass — only ever rendered for the
   * COMPACT Business/Location teaser card now; the Event page's own full
   * hero no longer shows a live-status pill at all (that signal moved
   * back to the white logistics card below it — see
   * EventScheduleSummary — so there's exactly one HAPPENING NOW
   * presentation on the page, not two). */
  statusLabel: string | null;
  isLive: boolean;
  /** Event Top Hierarchy Final Micro-pass — the best already-resolved
   * Location name for this Event (its host/featured Location, or the
   * legacy exact-venue-match — the same canonicalLocation
   * EventPublicView.tsx already resolves for every other Location
   * reference on the page), rendered directly beneath the title and
   * above the "by {attribution}" byline. Replaces the previous pass's
   * "date · venue" occurrenceMeta line — the hero no longer shows any
   * temporal metadata at all. Plain text, never a link (the whole hero
   * has no Location page to send someone to — see "About the Venue"
   * further down the page for that). Null/omitted renders nothing. */
  venueLabel?: string | null;
  /** Event Page Final Compression pass — no longer rendered anywhere (the
   * hero no longer shows a description excerpt at all; the single
   * description presentation lives in the page body below the actions).
   * Optional so a caller that still passes it (FeaturedEventCard passes
   * `null` for its own compact teaser, which never rendered this anyway)
   * keeps compiling without a second edit. */
  description?: string | null;
  /** Compact = Business/Location teaser card sizing; false = the Event
   * page's own full immersive hero. */
  compact?: boolean;
  /** "h1" on the Event page (the one real page title); "h2"/"h3" for a
   * teaser card living on a page whose own h1 is the Business/Location
   * name. */
  titleTag?: "h1" | "h2" | "h3";
  /** Public Event V2 — show the live/status pill on the full (non-compact)
   * Event hero too. Defaults to the compact teaser behavior only. */
  showStatusOnFull?: boolean;
}

export default function FeaturedEventHeroOverlay({
  category,
  title,
  attribution,
  attributionHref,
  venueLabel,
  statusLabel,
  isLive,
  compact = false,
  titleTag = "h2",
  showStatusOnFull = false,
}: FeaturedEventHeroOverlayProps) {
  const TitleTag = titleTag;

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 bottom-0 z-[2] flex flex-col justify-end ${
        compact ? "p-3 pt-16 sm:p-4" : "p-3 pt-14 sm:p-6 sm:pt-24"
      }`}
      style={{
        background:
          "linear-gradient(to top, rgba(0,0,0,0.90) 0%, rgba(0,0,0,0.70) 28%, rgba(0,0,0,0.28) 58%, rgba(0,0,0,0) 85%)",
      }}
    >
      <div className="flex flex-col gap-1">
        {category && (
          <span className="text-label font-bold uppercase tracking-wide text-white/80">{category}</span>
        )}
        <TitleTag
          className={`font-display font-bold tracking-tight text-white ${
            compact ? "text-card-title-lg line-clamp-2" : "text-display sm:text-display-lg line-clamp-2"
          }`}
        >
          {title}
        </TitleTag>
        {venueLabel && !compact && (
          <p className="text-body-lg font-semibold text-white/90 line-clamp-2">{venueLabel}</p>
        )}
        {attribution &&
          (attributionHref ? (
            <Link
              href={attributionHref}
              className="pointer-events-auto w-fit text-metadata font-medium text-white/80 underline decoration-white/40 underline-offset-2 transition hover:text-white"
            >
              by {attribution}
            </Link>
          ) : (
            <p className="text-metadata font-medium text-white/70">by {attribution}</p>
          ))}
        {/* Event Top Hierarchy Final Micro-pass — the live-status pill now
            renders ONLY for the compact Business/Location teaser card
            (unchanged, untouched treatment). The Event page's own full
            hero (compact=false) no longer shows HAPPENING NOW at all —
            that single presentation lives in the white logistics card
            below the hero now (EventScheduleSummary). */}
        {(compact || showStatusOnFull) && statusLabel && (
          <span
            className={`mt-0.5 inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
              isLive ? "bg-red-500/90 text-white" : "bg-white/15 text-white backdrop-blur-sm"
            }`}
          >
            {isLive && <LiveDot className="animate-happening-now-glow rounded-full text-red-500" />}
            {statusLabel}
          </span>
        )}
      </div>
    </div>
  );
}
