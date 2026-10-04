import Link from "next/link";

/** Admin V2 — Home's presentational primitives, on the shared V2 tokens
 * (white surface, thin border, rounded-2xl, semantic text sizes). A module
 * is a real working surface; single numbers never get their own card. */
export function ModulePanel({
  title,
  meta,
  children,
  flush = false,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  children: React.ReactNode;
  /** Rows run edge to edge (lists) instead of a padded body. */
  flush?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-black/[0.07] bg-white">
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-3.5">
        <h2 className="font-display text-card-title-lg font-bold text-primary">{title}</h2>
        {meta}
      </div>
      <div className={flush ? "" : "px-4 pb-4"}>{children}</div>
    </section>
  );
}

/** One cell in the Platform snapshot strip — never a card of its own. */
export function MetricCell({ label, count, href }: { label: string; count: number | undefined; href: string }) {
  return (
    <Link href={href} className="flex flex-col gap-0.5 px-4 py-3 transition hover:bg-black/[0.02]">
      <span className="font-display text-stat font-bold tabular-nums leading-none text-primary">{count ?? "—"}</span>
      <span className="text-metadata text-muted">{label}</span>
    </Link>
  );
}
