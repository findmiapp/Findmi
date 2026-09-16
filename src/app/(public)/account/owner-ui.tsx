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
