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
        <h2 id="growth-title" className="font-display text-section-title font-bold text-primary">
          Growth Manager
        </h2>
        <Link href={`${basePath}?tab=growth`} className="flex shrink-0 items-center gap-1 text-metadata font-semibold text-accent hover:underline">
          View All
          <ChevronIcon direction="right" className="h-3 w-3" />
        </Link>
      </div>

      <nav aria-label="Growth Manager">
        <ul className="mt-2.5 grid grid-cols-3 gap-2">
          {HOME_GROWTH_TILES.map(({ key, label }) => {
            const status = growthDestinationStatus(summary, key);
            return (
              <li key={key} className="min-w-0">
                <Link
                  href={growthHref(basePath, key)}
                  aria-label={`${label}: ${status.value}`}
                  className="flex h-full min-w-0 flex-col rounded-2xl border border-black/[0.08] bg-white p-2 transition min-[380px]:p-2.5 hover:border-findmi-200 hover:bg-findmi-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40 sm:flex-row sm:items-center sm:gap-2.5"
                >
                  <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-findmi-50 text-findmi-700 sm:h-9 sm:w-9 sm:rounded-xl">
                    {key === "goals" ? <NavIcon name="target" className="h-4 w-4 sm:h-[18px] sm:w-[18px]" /> : key === "opportunities" ? <NavIcon name="compass" className="h-4 w-4 sm:h-[18px] sm:w-[18px]" /> : <BulbGlyph className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />}
                  </span>
                  <span className="mt-1.5 min-w-0 flex-1 sm:mt-0">
                    <span className="block truncate text-[12px] font-bold leading-tight text-primary min-[380px]:text-[13px]">{label}</span>
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
