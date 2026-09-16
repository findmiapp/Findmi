/** Owner Command Center V4 — a small set of presentational primitives
 * actually exercised by this one page. Deliberately NOT a copy of
 * Admin's dashboard-ui.tsx: same underlying principle (a bounded surface
 * only when it represents a real, coherent concept — never a card around
 * one tiny number), but Owner keeps its own warmer, already-established
 * visual language (rounded-2xl, soft shadow, the exact card treatment
 * account/page.tsx's own Next Up/Inbox rows already used) rather than
 * Admin's flatter rounded-xl/hairline-border module. Family resemblance,
 * not a shared component — Admin and Owner serve different jobs. */

/** A bounded, purposeful Owner module — header (title + optional meta)
 * plus content. Used only for the handful of Command Center sections
 * that represent a genuine coherent surface (Where I'll Be, Needs
 * Attention when active, What You're Managing) — never wrapped around a
 * single stat or a one-line status. */
export function OwnerModule({
  title,
  meta,
  children,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">{title}</h2>
        {meta}
      </div>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

/** The compact, non-modal treatment for "nothing to see here right now"
 * — one row, never a full OwnerModule reserved for an empty state (the
 * same correction Admin V5.1 made to its own Needs Attention). Used for
 * Needs Attention when clear and Inbox when empty. */
export function CompactStatus({ label, tone = "neutral" }: { label: React.ReactNode; tone?: "neutral" | "positive" }) {
  return (
    <div
      className={`rounded-xl px-3.5 py-2.5 text-sm ${
        tone === "positive" ? "bg-emerald-50/60 font-medium text-emerald-700" : "bg-black/[0.03] text-ink/50"
      }`}
    >
      {label}
    </div>
  );
}
