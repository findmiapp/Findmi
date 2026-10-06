import type { LifecycleStep } from "@/lib/opportunity-listings-domain";

/** Presentational Draft → Open → Responses → Confirmed → Completed stepper
 * (mapping in getOpportunityLifecycle — nothing persisted). Horizontal at
 * every width; per-step hints show from sm up, and on phones the current
 * step's hint is written out underneath instead. */
export default function OpportunityLifecycle({ steps, note }: { steps: LifecycleStep[]; note?: string | null }) {
  const current = steps.find((s) => s.state === "current");
  return (
    <section aria-label="Opportunity Progress" className="rounded-2xl border border-black/[0.08] bg-white px-1.5 py-4 sm:px-5">
      <ol className="grid grid-cols-5">
        {steps.map((s, i) => {
          const done = s.state === "done";
          const isCurrent = s.state === "current";
          return (
            <li key={s.key} aria-current={isCurrent ? "step" : undefined} className="relative flex min-w-0 flex-col items-center text-center sm:items-start sm:text-left">
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className={`absolute right-1/2 top-3.5 h-px w-full sm:right-[calc(100%-0.875rem)] ${
                    done || isCurrent ? "bg-findmi" : "bg-black/10"
                  }`}
                />
              )}
              <span
                className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                  done ? "bg-findmi text-white" : isCurrent ? "bg-findmi text-white ring-4 ring-findmi/15" : "border border-black/15 bg-white text-ink/40"
                }`}
              >
                {done ? (
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
                    <path d="m3.5 8.5 3 3 6-7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span className={`mt-1.5 max-w-full truncate px-0.5 text-[10px] font-semibold tracking-tight min-[400px]:text-[11px] sm:px-0 sm:text-sm sm:tracking-normal ${isCurrent ? "text-ink" : done ? "text-ink/75" : "text-ink/40"}`}>
                {s.label}
              </span>
              <span className={`hidden text-xs leading-snug sm:block ${isCurrent ? "text-ink/55" : "text-ink/35"}`}>{s.hint}</span>
            </li>
          );
        })}
      </ol>
      {(current || note) && (
        <p className="mt-3 text-center text-xs text-ink/55 sm:hidden">
          {current ? `${current.label} — ${current.hint}` : null}
          {note ? `${current ? " · " : ""}${note}` : null}
        </p>
      )}
      {note && <p className="mt-3 hidden text-xs text-ink/55 sm:block">{note}</p>}
    </section>
  );
}
