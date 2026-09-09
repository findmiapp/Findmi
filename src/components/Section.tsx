import Link from "next/link";

export default function Section({
  title,
  subtitle,
  viewAllHref,
  children,
  className = "py-6",
}: {
  title: string;
  subtitle?: string;
  viewAllHref?: string;
  children: React.ReactNode;
  /** Replaces (never appends to) the default "py-6" outer vertical
   * rhythm — a plain string swap avoids the usual Tailwind class-order
   * footgun of trying to override py-6 by appending a second py-*
   * utility. Every existing caller omits this and keeps today's exact
   * spacing; Business Directory Visual Rhythm pass is the first caller
   * to pass a tighter value, scoped to /businesses' own Browse Mode
   * rails only. */
  className?: string;
}) {
  return (
    <section className={className}>
      {/* Launch-polish follow-up: View All used to sit inside the same
          items-end row as the title+subtitle stack, so with a subtitle
          present it bottom-aligned to the SUBTITLE line, not the title —
          reading as if it belonged with the filter pills underneath. The
          title/View All pair is now its own row (items-center, so View
          All vertically centers against the title specifically), with the
          subtitle continuing on its own line below either way. */}
      <div className="mb-3 px-4 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
          {viewAllHref && (
            <Link
              href={viewAllHref}
              className="shrink-0 text-xs font-semibold text-ink/55 underline decoration-ink/25 underline-offset-4 transition hover:text-ink hover:decoration-ink/50"
            >
              View all
            </Link>
          )}
        </div>
        {subtitle && <p className="mt-1 text-sm text-ink/55">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

export function HorizontalScroller({
  children,
  className = "",
}: {
  children: React.ReactNode;
  /** Extra classes appended after the defaults — e.g. a touch of top
   * padding for a caller whose cards have a selected-state ring/border
   * that would otherwise butt right up against this container's own top
   * edge and get clipped by its (required, for horizontal scroll)
   * overflow-x-auto — see EventOccurrenceCard's Upcoming Dates usage.
   * Every other caller passes nothing and renders exactly as before. */
  className?: string;
}) {
  return (
    <div
      className={`flex gap-4 overflow-x-auto px-4 pb-2 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
    >
      {children}
    </div>
  );
}
