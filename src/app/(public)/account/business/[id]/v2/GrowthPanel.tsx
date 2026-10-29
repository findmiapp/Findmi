import Link from "next/link";
import NavIcon from "@/components/NavIcon";
import ChevronIcon from "@/components/ChevronIcon";
import { growthDestinationStatus, growthHref, type GrowthDestination, type GrowthSummary } from "@/lib/growth";

/** Home's three Growth Manager entry points, in order. Targets keep their own
 * Create & Manage card (and Growth → Targets) — not repeated here. */
export const HOME_GROWTH_TILES: { key: Extract<GrowthDestination, "goals" | "opportunities" | "ideas">; label: string }[] = [
  { key: "goals", label: "Goals" },
  { key: "opportunities", label: "Opportunities" },
  { key: "ideas", label: "Ideas" },
];

/** Business Home → GROWTH MANAGER: three compact tools — Goals, Opportunities,
 * Ideas — each a one-tap deep link into that exact Growth destination
 * (growthHref) with its real one-line status from the Growth summary
 * (lib/growth.ts growthDestinationStatus: row counts only, never invented; a
 * destination with nothing yet says how to start). No destination is gated
 * behind another. The full Growth workspace stays one tap away ("View All"). */
export default function GrowthPanel({ basePath, summary }: { basePath: string; summary: GrowthSummary }) {
  return (
    <section id="home-growth" aria-labelledby="growth-title" className="scroll-mt-[104px]">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="growth-title" className="font-display text-section-title font-bold leading-tight text-primary">
          Growth Manager
        </h2>
        <Link href={`${basePath}?tab=growth`} className="flex shrink-0 items-center gap-1 text-metadata font-semibold text-accent hover:underline">
          View All
          <ChevronIcon direction="right" className="h-3 w-3" />
        </Link>
      </div>

      {/* ONE shared toolbar split into three short cells: icon + name on one
          line, the real status under it — management shortcuts, not cards. */}
      <nav aria-label="Growth Manager">
        <ul className="mt-1.5 grid grid-cols-3 divide-x divide-black/[0.06] overflow-hidden rounded-xl border border-black/[0.07] bg-white">
          {HOME_GROWTH_TILES.map(({ key, label }) => {
            const status = growthDestinationStatus(summary, key);
            return (
              <li key={key} className="min-w-0">
                <Link
                  href={growthHref(basePath, key)}
                  aria-label={`${label}: ${status.value}`}
                  className="flex h-full min-h-11 min-w-0 flex-col justify-center px-1.5 py-1.5 transition hover:bg-findmi-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-findmi/40 min-[380px]:px-2 sm:flex-row sm:items-center sm:gap-2 sm:px-3"
                >
                  <span className="block min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1">
                      <span aria-hidden="true" className="shrink-0 text-findmi-700">
                        {key === "goals" ? <NavIcon name="target" className="h-3 w-3 min-[380px]:h-3.5 min-[380px]:w-3.5" /> : key === "opportunities" ? <NavIcon name="compass" className="h-3 w-3 min-[380px]:h-3.5 min-[380px]:w-3.5" /> : <BulbGlyph className="h-3 w-3 min-[380px]:h-3.5 min-[380px]:w-3.5" />}
                      </span>
                      <span className="truncate text-[12px] font-bold leading-tight tracking-[-0.01em] text-primary min-[400px]:text-[13px]">{label}</span>
                    </span>
                    <span className={`mt-0.5 line-clamp-2 block text-[11px] leading-tight ${status.highlight ? "font-semibold text-findmi-700" : "text-muted"}`}>{status.value}</span>
                  </span>
                  <ChevronIcon direction="right" className="hidden h-3 w-3 shrink-0 text-subtle sm:block" />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </section>
  );
}

/** 24px / 1.8-stroke family, same as NavIcon. */
function BulbGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M9 18h6M10 21h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 3a6 6 0 00-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0012 3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
