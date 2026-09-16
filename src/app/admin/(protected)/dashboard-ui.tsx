import Link from "next/link";

/** Findmi 2026 Visual System — Pass 1 (Admin Command Center proving
 * ground). A SMALL set of presentational primitives actually exercised by
 * the Command Center — not a general design-system library. Typography +
 * spacing + alignment carry the hierarchy here; containers (borders/
 * shadows/backgrounds) are used only where a boundary communicates
 * something real (a floating dropdown, a genuinely separate group), never
 * as the default way to present a section or a metric. Scoped to this one
 * page/route group — nothing here is imported by, or changes the
 * rendering of, any public or owner-facing surface. */

export function PageEyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-bold uppercase tracking-wide text-ink/40">{children}</p>;
}

/** The small uppercase label that introduces a page section (Needs
 * Attention / At a Glance / Quick Actions / …) — deliberately text only,
 * no card wrapper: the section boundary is spacing, not a box. */
export function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-[11px] font-bold uppercase tracking-wide text-ink/40">{children}</h2>
      {action}
    </div>
  );
}

/** One cell in the At a Glance metric strip — number-forward, label
 * quiet, no card/border/shadow of its own. The strip's own container
 * supplies the only structure (a hairline divider between cells), so
 * eight metrics read as one coherent instrument panel instead of eight
 * independent boxes competing for attention. */
export function MetricCell({ label, count, href }: { label: string; count: number | undefined; href: string }) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-0.5 px-3 py-2.5 transition hover:bg-black/[0.02] sm:px-4 sm:py-3"
    >
      <span className="font-display text-xl font-bold tabular-nums text-ink sm:text-2xl">{count ?? "—"}</span>
      <span className="text-[11px] font-medium text-ink/50">{label}</span>
    </Link>
  );
}

/** One compact navigation destination row for Manage / Site & Discovery —
 * a list, not a grid of cards: a hairline bottom divider between rows
 * (never a border around each row), consistent tap/click target height,
 * icon reserved for recognition rather than decoration. */
export function NavRow({ letter, label, description, href }: { letter: string; label: string; description: string; href: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 py-2.5 transition hover:bg-black/[0.02] sm:px-1.5 sm:-mx-1.5 sm:rounded-lg">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-findmi-50 text-xs font-bold text-findmi-700">
        {letter}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-ink">{label}</span>
        <span className="block truncate text-xs text-ink/45">{description}</span>
      </span>
    </Link>
  );
}

/** Compact Quick Action control — a tappable row, not a large bordered
 * tile: consistent height on mobile and desktop alike, aqua reserved for
 * the plus glyph only (one small branded touch, not a filled button per
 * action). */
export function QuickActionRow({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-lg border border-black/10 px-3 py-2 text-sm font-medium text-ink transition hover:border-findmi/40 hover:bg-findmi-50"
    >
      <span aria-hidden className="text-findmi-600">
        +
      </span>
      {label}
    </Link>
  );
}
