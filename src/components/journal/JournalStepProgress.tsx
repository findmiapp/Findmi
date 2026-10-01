/** Journal V1 (visual convergence pass) — a compact four-segment progress
 * bar replacing a dominant "STEP 1 OF 4" text line. Purely presentational;
 * the four-step architecture itself is unchanged. */
export default function JournalStepProgress({ step }: { step: 1 | 2 | 3 | 4 }) {
  return (
    <div className="mt-3 flex items-center gap-1.5" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={4}>
      {[1, 2, 3, 4].map((s) => (
        <span key={s} className={`h-1 flex-1 rounded-full ${s <= step ? "bg-findmi" : "bg-black/10"}`} />
      ))}
    </div>
  );
}
