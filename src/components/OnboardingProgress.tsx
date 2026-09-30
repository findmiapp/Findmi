/** Join / Universal Onboarding pass — a small, honest step indicator for
 * the two screens that come after account creation (/join/start,
 * /join/passbook). Deliberately not shown on /join (no account yet, so
 * "step 1" would be misleading) or /join/welcome (the destination, not a
 * step). Steps differ between the Passbook and Business paths (Business
 * hands off to the existing /account/business/new flow, which has its
 * own hierarchy and shouldn't inherit this indicator) — `total` is passed
 * in per page rather than hardcoded here, so it's never misleading across
 * branches. */
export default function OnboardingProgress({
  step,
  total,
  labels,
}: {
  step: number;
  total: number;
  labels: string[];
}) {
  return (
    <div className="flex items-center gap-2" aria-label={`Step ${step} of ${total}`}>
      {labels.map((label, i) => {
        const index = i + 1;
        const done = index < step;
        const current = index === step;
        return (
          <div key={label} className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  done
                    ? "bg-findmi text-white"
                    : current
                      ? "border-2 border-findmi text-findmi-700"
                      : "border border-black/15 text-ink/35"
                }`}
              >
                {done ? "✓" : index}
              </span>
              <span className={`text-xs font-semibold ${current ? "text-ink" : "text-ink/40"}`}>{label}</span>
            </div>
            {index < total && <span className="h-px w-4 bg-black/10" aria-hidden />}
          </div>
        );
      })}
    </div>
  );
}
