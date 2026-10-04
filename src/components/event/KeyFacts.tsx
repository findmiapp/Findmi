import Link from "next/link";
import type { ReactNode } from "react";

/** Public Event V2 — the compact, borderless WHEN / WHERE essentials shown
 * right under the hero. Presentational only (no hooks), shared by the
 * multi-date path (EventScheduleSummary, client, per selected date) and
 * the single-date path (EventPublicView, server). */

export function KeyFactRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-findmi-50 text-findmi-700">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function WhenFact({
  dateLabel,
  detail,
  status,
}: {
  dateLabel: string;
  /** Time and/or "· 14 dates". */
  detail?: string | null;
  status?: ReactNode;
}) {
  return (
    <KeyFactRow icon={<CalendarGlyph className="h-[18px] w-[18px]" />}>
      <p className="text-card-title-lg font-bold leading-snug text-primary">{dateLabel}</p>
      {detail && <p className="text-body text-secondary">{detail}</p>}
      {status && <div className="mt-0.5">{status}</div>}
    </KeyFactRow>
  );
}

export function WhereFact({
  name,
  href,
  line,
}: {
  name: string | null;
  href?: string | null;
  /** Address / place context. */
  line?: string | null;
}) {
  if (!name && !line) return null;
  return (
    <KeyFactRow icon={<PinGlyph className="h-[18px] w-[18px]" />}>
      {name &&
        (href ? (
          <Link
            href={href}
            className="group inline-flex max-w-full items-center gap-1 text-card-title-lg font-bold leading-snug text-primary hover:text-findmi-700"
          >
            <span className="min-w-0 break-words">{name}</span>
            <ChevronGlyph className="h-3.5 w-3.5 shrink-0 text-ink/30 transition group-hover:text-findmi-700" />
          </Link>
        ) : (
          <p className="break-words text-card-title-lg font-bold leading-snug text-primary">{name}</p>
        ))}
      {line && <p className="break-words text-body text-secondary">{line}</p>}
    </KeyFactRow>
  );
}

export function LiveStatus({ until }: { until?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-metadata font-bold text-red-600">
      <span className="relative flex h-2 w-2">
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
      <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
