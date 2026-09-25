import type { ReactNode } from "react";
import Link from "next/link";

/** Findmi Owner Product — authenticated visual system (Sept 2026
 * redesign). Not a restyle of the old "text section + thin divider"
 * grammar: this is the actual component vocabulary the authenticated
 * Owner product (Command Center, Business Manager) now speaks — a
 * workspace, not a stack of marketing-style white cards.
 *
 * Rules this file exists to enforce:
 *  - A bounded Panel is for a real, multi-row operating concept. A
 *    single fact (a count, a URL, a toggle) is a Row, never its own
 *    Panel — a Panel around one line of text is exactly the "0 active
 *    products consuming 140px" failure this system replaces.
 *  - One empty state per real gap. Two components independently
 *    reporting the same missing thing (an attention item AND a "nothing
 *    here" card saying the same fact) is a bug, not two features.
 *  - Findmi Aqua is the ONE accent color: primary actions, the active
 *    nav item, selected/live state. Status uses a small dot + quiet
 *    text, not a rainbow of pill colors. */

// ── Panel — a real bounded module ──────────────────────────────────
export function Panel({
  title,
  meta,
  padded = true,
  className = "",
  children,
}: {
  title?: ReactNode;
  meta?: ReactNode;
  padded?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`rounded-xl border border-black/[0.07] bg-white ${className}`}>
      {title && (
        <div className={`flex items-center justify-between gap-3 border-b border-black/[0.06] ${padded ? "px-4 py-3" : "px-4 py-2.5"}`}>
          <h2 className="text-[13px] font-bold text-ink">{title}</h2>
          {meta}
        </div>
      )}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}

// ── Row — the dense, scannable unit: label/value on one line ───────
export function Row({
  label,
  value,
  href,
  tone = "default",
  icon,
}: {
  label: ReactNode;
  value?: ReactNode;
  href?: string;
  tone?: "default" | "quiet";
  icon?: ReactNode;
}) {
  const content = (
    <>
      <span className="flex min-w-0 shrink items-center gap-2">
        {icon && <span className="shrink-0 text-ink/35">{icon}</span>}
        <span className={`truncate text-[13px] ${tone === "quiet" ? "text-ink/50" : "font-medium text-ink"}`}>{label}</span>
      </span>
      {value && <span className="max-w-[55%] shrink-0 text-right text-[13px] font-semibold text-ink/70">{value}</span>}
    </>
  );
  if (href) {
    return (
      <Link href={href} className="flex items-center justify-between gap-3 px-4 py-2.5 transition hover:bg-black/[0.02]">
        {content}
      </Link>
    );
  }
  return <div className="flex items-center justify-between gap-3 px-4 py-2.5">{content}</div>;
}

/** A list of Rows inside a Panel — thin hairline dividers, no outer
 * padding (Rows carry their own px-4 py-2.5). */
export function RowList({ children }: { children: ReactNode }) {
  return <div className="flex flex-col divide-y divide-black/[0.05]">{children}</div>;
}

// ── Stat — a headline number with real typographic weight ──────────
export function Stat({ value, label, tone = "default" }: { value: ReactNode; label: string; tone?: "default" | "up" | "down" }) {
  return (
    <div>
      <p className="font-display text-[1.75rem] font-bold leading-none tracking-tight text-ink tabular-nums">{value}</p>
      <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink/40">{label}</p>
      {tone !== "default" && (
        <p className={`mt-0.5 text-[11px] font-bold ${tone === "up" ? "text-findmi-700" : "text-ink/35"}`}>
          {tone === "up" ? "↑" : "↓"}
        </p>
      )}
    </div>
  );
}

// ── Dot — status semantics as a colored dot + quiet text, not a pill
//    for every axis. Reserve Chip (below) for real filter/selection
//    state; Dot is for read-only status inline in a Row/line of text. ──
const DOT_TONE: Record<string, string> = {
  live: "bg-findmi",
  positive: "bg-findmi",
  attention: "bg-amber-500",
  negative: "bg-red-500",
  quiet: "bg-black/20",
};
export function StatusDot({ tone = "quiet", label }: { tone?: "live" | "positive" | "attention" | "negative" | "quiet"; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_TONE[tone]}`} />
      <span className="text-[13px] text-ink/60">{label}</span>
    </span>
  );
}

// ── Chip — for a real selectable/filter/plan state, filled + compact.
const CHIP_TONE: Record<string, string> = {
  aqua: "bg-findmi text-white",
  aquaSoft: "bg-findmi-50 text-findmi-700",
  amber: "bg-amber-100 text-amber-800",
  neutral: "bg-black/[0.06] text-ink/55",
};
export function Chip({ tone = "neutral", children }: { tone?: "aqua" | "aquaSoft" | "amber" | "neutral"; children: ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${CHIP_TONE[tone]}`}>
      {children}
    </span>
  );
}

// ── EmptyLine — ONE compact, single-purpose empty state. Never a
//    second component restating what an attention item already said. ──
export function EmptyLine({ children, action }: { children: ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <p className="text-[13px] text-ink/45">{children}</p>
      {action && (
        <Link href={action.href} className="shrink-0 text-[12px] font-bold text-findmi-700">
          {action.label}
        </Link>
      )}
    </div>
  );
}

// ── SectionEyebrow — quiet label above a group of Rows/content that
//    isn't itself a full Panel (e.g. a page-level grouping). ──────────
export function SectionEyebrow({ children, action }: { children: ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-ink/35">{children}</p>
      {action && (
        <Link href={action.href} className="text-[11px] font-bold text-findmi-700">
          {action.label}
        </Link>
      )}
    </div>
  );
}

// ── PrimaryButton / SecondaryButton — the two button weights the
//    Owner product actually needs; every CTA in this system is one of
//    these two, never a bespoke one-off class string. ─────────────────
export function primaryButtonClass(size: "sm" | "md" = "md") {
  return size === "sm"
    ? "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-findmi px-3 text-[12px] font-bold text-white transition hover:bg-findmi-600 active:scale-[0.98]"
    : "inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-findmi px-4 text-[13px] font-bold text-white transition hover:bg-findmi-600 active:scale-[0.98]";
}
export function secondaryButtonClass(size: "sm" | "md" = "md") {
  return size === "sm"
    ? "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-black/10 px-3 text-[12px] font-semibold text-ink transition hover:border-black/20"
    : "inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-black/10 px-4 text-[13px] font-semibold text-ink transition hover:border-black/20";
}

// ── Performance Command Center pass — three additive primitives, built
// for Analytics but generic enough for any future report-style surface
// (another metric strip, another ranked/proportional list). None of the
// existing exports above are modified — every other Business Manager
// tab that already imports Panel/Row/RowList/Stat/etc. is unaffected. ──

/** A single headline metric, sized to actually anchor a page (not a
 * Stat's supporting-number scale) — the KPI Command Strip's one unit.
 * `comparison` is pre-formatted by the caller (e.g. from an existing
 * OwnerPerformanceMetric's own changeLabel, or a low-data absolute
 * fallback) — this component never computes or reinterprets a
 * percentage itself. `helpText` is shown only when there's no
 * comparison to display (e.g. Followers, which has no period-over-
 * period figure today), so a metric never shows two competing caption
 * lines. */
export function PerformanceMetric({
  label,
  value,
  comparison,
  comparisonTone = "neutral",
  helpText,
}: {
  label: string;
  value: ReactNode;
  comparison?: string | null;
  comparisonTone?: "up" | "down" | "neutral";
  helpText?: string | null;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="truncate text-[10.5px] font-bold uppercase tracking-wide text-ink/40">{label}</p>
      <p className="font-display text-[1.85rem] font-bold leading-none tracking-tight text-ink tabular-nums sm:text-[2.1rem]">
        {value}
      </p>
      {comparison ? (
        <p className={`text-[11.5px] font-semibold ${comparisonTone === "up" ? "text-findmi-700" : "text-ink/45"}`}>{comparison}</p>
      ) : (
        helpText && <p className="text-[11.5px] text-ink/40">{helpText}</p>
      )}
    </div>
  );
}

/** A labeled value with a proportional fill bar beneath it — "how much
 * of the whole does this row represent," read from a share the caller
 * already computed (e.g. one Discovery Source's impressions divided by
 * the total across all sources). `share` is 0..1; this component only
 * clamps and renders it, it never derives a percentage from raw counts
 * itself. */
export function ShareBar({
  label,
  value,
  share,
  sublabel,
}: {
  label: ReactNode;
  value: ReactNode;
  share: number;
  sublabel?: ReactNode;
}) {
  const widthPercent = Math.max(0, Math.min(1, share)) * 100;
  return (
    <div className="flex flex-col gap-1.5 px-4 py-2.5">
      {/* Low-data mobile pass — was a rigid single-line row (label
          shrinking against a shrink-0 value); a longer value string
          (now including an explicit share percentage, see the caller)
          could force overflow on a narrow phone. flex-wrap lets the
          value drop to its own line as a whole unit instead — never
          truncated, never overflowing. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="min-w-0 truncate text-[13px] font-medium text-ink">{label}</span>
        <span className="shrink-0 text-[13px] font-semibold text-ink/70">{value}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/[0.05]">
        <div className="h-full rounded-full bg-findmi" style={{ width: `${widthPercent}%` }} />
      </div>
      {sublabel && <span className="text-[11px] text-ink/40">{sublabel}</span>}
    </div>
  );
}

/** One row in a ranked list (Top Appearances/Top Products) — a rank
 * badge, title/subtitle, and a relative-performance bar. `relativeScore`
 * is 0..1, already normalized by the caller against the TOP item in the
 * same already-server-ranked list — this component never re-sorts or
 * re-scores anything, it only renders the rank position and proportion
 * it's given. Rank 1 gets the one accent treatment in the list (a
 * filled Aqua badge); every other rank is a quiet numbered outline, so
 * the list reads as "here's what's winning," not a rainbow leaderboard. */
export function RankedPerformanceRow({
  rank,
  title,
  subtitle,
  metricLine,
  relativeScore,
  href,
}: {
  rank: number;
  title: ReactNode;
  subtitle?: ReactNode;
  metricLine?: ReactNode;
  relativeScore: number;
  href?: string;
}) {
  const widthPercent = Math.max(0, Math.min(1, relativeScore)) * 100;
  const content = (
    <>
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
          rank === 1 ? "bg-findmi text-white" : "bg-black/[0.05] text-ink/50"
        }`}
      >
        {rank}
      </span>
      <span className="min-w-0 flex-1">
        {/* Title, metric line, and subtitle each get their own truncated
            line (never forced onto one row) — a long product name next
            to a long metric string (e.g. every one of Products' 5
            metrics active at once) must never force horizontal overflow
            on a narrow phone; each line degrades independently instead. */}
        <span className="block truncate text-[13px] font-semibold text-ink">{title}</span>
        {metricLine && <span className="mt-0.5 block truncate text-[11.5px] font-semibold text-ink/55">{metricLine}</span>}
        {subtitle && <span className="mt-0.5 block truncate text-[11px] text-ink/40">{subtitle}</span>}
        <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-black/[0.05]">
          <span className="block h-full rounded-full bg-findmi/60" style={{ width: `${widthPercent}%` }} />
        </span>
      </span>
    </>
  );
  const rowClass = "flex items-center gap-3 px-4 py-2.5";
  if (href) {
    return (
      <Link href={href} className={`${rowClass} transition hover:bg-black/[0.02]`}>
        {content}
      </Link>
    );
  }
  return <div className={rowClass}>{content}</div>;
}
