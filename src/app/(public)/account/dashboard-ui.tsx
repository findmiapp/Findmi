/** Account Command Center V2 — a small set of presentational primitives
 * actually exercised by this one page. Same underlying principle as
 * before (a bounded surface only when it represents a real, coherent
 * concept — never a card around one tiny number), but now matched to
 * Business Overview's visual language: a real bordered container is
 * reserved for genuinely coherent list/rail sections (Today/Coming Up,
 * Inbox); Needs Attention gets the lighter SoftZone treatment instead
 * (soft tint, no border/shadow), same as Business Overview's own Needs
 * Attention module — fewer generic white SaaS cards, not a copy-paste
 * restyle. Family resemblance with the Business Overview module
 * language, not a shared component — /account and Business Overview
 * serve different jobs but should now read as siblings in one product. */

/** A bounded, purposeful Owner module — header (title + optional meta)
 * plus content. Lighter than before (no shadow, a hairline border
 * instead) — reserved for a genuine coherent list/rail (Today/Coming Up,
 * Inbox), never wrapped around a single stat or a one-line status. */
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
    <section className="rounded-2xl border border-black/[0.06] bg-white p-3.5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">{title}</h2>
        {meta}
      </div>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

/** Soft, borderless operational zone — the same light-tint treatment
 * Business Overview uses for Needs Attention (`bg-black/[0.025]`, no
 * border/shadow): actionable rows read as an operational feed, not a
 * feature card. */
export function SoftZone({
  title,
  meta,
  children,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl bg-black/[0.025] p-3.5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink/45">{title}</h2>
        {meta}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** The compact, non-modal treatment for "nothing to see here right now"
 * — one row, never a full module reserved for an empty state. Used for
 * Inbox when empty. */
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
