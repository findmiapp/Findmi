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
 * problem. */
export interface FeaturedEventHeroOverlayProps {
  category: string | null;
  title: string;
  /** Rendered as "by {attribution}" — the Event's own featured/primary
   * participating Business (event_businesses.featured), never invented. */
  attribution: string | null;
  /** Pre-resolved copy (e.g. "Happening Now") from the caller's own
   * getTemporalLabel() read — this component never computes or guesses
   * status itself. Null renders no pill at all. */
  statusLabel: string | null;
  isLive: boolean;
  description: string | null;
  /** Compact = Business/Location teaser card sizing; false = the Event
   * page's own full immersive hero. */
  compact?: boolean;
  /** "h1" on the Event page (the one real page title); "h2"/"h3" for a
   * teaser card living on a page whose own h1 is the Business/Location
   * name. */
  titleTag?: "h1" | "h2" | "h3";
}

export default function FeaturedEventHeroOverlay({
  category,
  title,
  attribution,
  statusLabel,
  isLive,
  description,
  compact = false,
  titleTag = "h2",
}: FeaturedEventHeroOverlayProps) {
  const TitleTag = titleTag;

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 bottom-0 z-[2] flex flex-col justify-end ${
        compact ? "p-3 pt-16 sm:p-4" : "p-4 pt-32 sm:p-7 sm:pt-44"
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
            compact ? "text-card-title-lg line-clamp-2" : "text-display sm:text-display-lg line-clamp-3"
          }`}
        >
          {title}
        </TitleTag>
        {attribution && <p className="text-metadata font-medium text-white/70">by {attribution}</p>}
        {statusLabel && (
          <span
            className={`mt-0.5 inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
              isLive ? "bg-red-500/90 text-white" : "bg-white/15 text-white backdrop-blur-sm"
            }`}
          >
            {isLive && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-white" />}
            {statusLabel}
          </span>
        )}
        {description && !compact && (
          <p className="mt-1.5 max-w-xl text-body text-white/85 line-clamp-2">{description}</p>
        )}
      </div>
    </div>
  );
}
