import Link from "next/link";

/** Findmi 2026 Visual System — Command Center V5. A small set of
 * presentational primitives actually exercised by the Command Center.
 *
 * V4 correction: "fewer cards" was the wrong rule — the right rule is NO
 * MEANINGLESS CONTAINERS. A bounded module (ModulePanel) is appropriate
 * when it represents a coherent working surface (Needs Attention, Recent
 * Activity, Platform Snapshot) — that's a real boundary, not decoration.
 * What V4 got right and this keeps: no card for a single number, no
 * shadow-heavy floating tiles, typography/spacing doing the hierarchy
 * work inside each module. Scoped to this one route group — nothing
 * here changes any public or owner-facing surface. */

/** A bounded operational module — the thing V4 was missing. Subtle
 * border + white surface (a little depth is fine; heavy shadow isn't),
 * a real header (title + optional meta/action), content below. */
export function ModulePanel({
  title,
  meta,
  children,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-black/[0.07] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      <div className="flex items-center justify-between gap-3 border-b border-black/[0.06] px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {meta}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** One cell in the Platform Snapshot strip. `tone="primary"` (core
 * platform-scale counts) reads larger and bolder; `tone="secondary"`
 * (low-signal pipeline counters like Inquiries/Orders when they're near
 * zero) is deliberately quieter — same cell shape, different weight, so
 * eight metrics don't compete as equals when they aren't operationally
 * equal. Never a card of its own.
 *
 * V5.1 correction — mobile vertical padding tightened (py-2, was 2.5) so
 * six cells take noticeably less height on a phone; `sm:` and up is
 * untouched (still py-2.5), preserving the approved V5 desktop/tablet
 * density exactly. */
export function MetricCell({
  label,
  count,
  href,
  tone = "primary",
}: {
  label: string;
  count: number | undefined;
  href: string;
  tone?: "primary" | "secondary";
}) {
  return (
    <Link href={href} className="flex flex-col gap-0.5 px-3 py-2 transition hover:bg-black/[0.02] sm:px-4 sm:py-2.5">
      <span
        className={
          tone === "primary"
            ? "font-display text-2xl font-bold tabular-nums leading-none text-ink"
            : "font-display text-lg font-semibold tabular-nums leading-none text-ink/60"
        }
      >
        {count ?? "—"}
      </span>
      <span className={tone === "primary" ? "text-[11px] font-medium text-ink/50" : "text-[11px] text-ink/40"}>{label}</span>
    </Link>
  );
}
