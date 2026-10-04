import Link from "next/link";
import type { ReactNode } from "react";

/** Public Event V2.1 — the compact WHEN | WHERE facts band shown right
 * under the hero. One two-column band on phones (≈50/50, a hairline
 * vertical divider, no cards); stacked with a horizontal hairline in the
 * narrow desktop rail. Presentational only (no hooks), shared by the
 * multi-date path (EventScheduleSummary, client, per selected date) and
 * the single-date path (EventPublicView, server). */

export function FactsBand({ when, where }: { when: ReactNode; where: ReactNode }) {
  if (!where) return <div>{when}</div>;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-1">
      <div className="min-w-0 border-r border-black/[0.08] pr-3.5 lg:border-b lg:border-r-0 lg:pb-4 lg:pr-0">{when}</div>
      <div className="min-w-0 pl-3.5 lg:pl-0 lg:pt-4">{where}</div>
    </div>
  );
}

function FactLabel({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-label font-bold uppercase text-subtle">
      <span className="text-findmi-600">{icon}</span>
      {children}
    </p>
  );
}

export function WhenFact({
  dateLabel,
  detail,
  count,
  status,
}: {
  dateLabel: string;
  /** The time line only — never with the date count appended. */
  detail?: string | null;
  /** "12 dates" — its own secondary line, so it can never hang off the
   * end of the time and wrap "dates" by itself. Omit for a single date. */
  count?: string | null;
  status?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <FactLabel icon={<CalendarGlyph className="h-3.5 w-3.5" />}>When</FactLabel>
      <p className="mt-1 break-words text-card-title font-bold text-primary">{dateLabel}</p>
      {detail && <p className="mt-0.5 text-metadata text-secondary">{detail}</p>}
      {count && <p className="text-metadata text-muted">{count}</p>}
      {status && <div className="mt-1">{status}</div>}
    </div>
  );
}

export function WhereFact({
  name,
  href,
  line,
  action,
}: {
  name: string | null;
  href?: string | null;
  /** Address / place context. */
  line?: string | null;
  /** A small trailing link (e.g. Directions). */
  action?: ReactNode;
}) {
  if (!name && !line) return null;
  return (
    <div className="min-w-0">
      <FactLabel icon={<PinGlyph className="h-3.5 w-3.5" />}>Where</FactLabel>
      {name &&
        (href ? (
          <Link
            href={href}
            className="mt-1 block break-words text-card-title font-bold text-primary transition hover:text-findmi-700"
          >
            {name}
            <ChevronGlyph className="ml-0.5 inline h-3 w-3 -translate-y-px text-ink/30" />
          </Link>
        ) : (
          <p className="mt-1 break-words text-card-title font-bold text-primary">{name}</p>
        ))}
      {line && <p className="mt-0.5 line-clamp-2 break-words text-metadata text-secondary">{line}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** Quiet text link used for Directions inside the Where column. */
export const factLinkClass = "inline-flex items-center gap-1 text-metadata font-semibold text-findmi-700 hover:underline";

export function LiveStatus({ until }: { until?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-metadata font-bold text-red-600">
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-60 motion-safe:animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-red-600" />
      </span>
      Happening now{until ? ` · until ${until}` : ""}
    </span>
  );
}

export function QuietStatus({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "red" }) {
  return <span className={`text-metadata font-semibold ${tone === "red" ? "text-red-700" : "text-muted"}`}>{children}</span>;
}

/** Subtle "Ended" tag for a past event — the historical dates stay the
 * headline; this only qualifies them. */
export function EndedStatus() {
  return (
    <span className="inline-flex items-center rounded-full bg-black/[0.05] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
      Ended
    </span>
  );
}

export function CalendarGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PinGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M12 21s7-6.2 7-11.5A7 7 0 105 9.5C5 14.8 12 21 12 21z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="9.5" r="2.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
