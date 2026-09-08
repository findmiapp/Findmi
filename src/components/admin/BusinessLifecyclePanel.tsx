"use client";

/**
 * Admin Business Pause/Restore UX pass — a fast, obvious, prominently
 * placed alternative to the Moderation tab's 5-option Listing Status
 * dropdown (which remains available unchanged as the advanced/manual
 * control). Renders only for the two states this pass covers — "live"
 * (offer Pause) and "paused" (offer Restore) — never for draft/
 * pending_review/rejected, which keep their existing Approve/Reject/
 * Moderation workflow untouched (see this page's own PendingReviewPanel
 * for pending_review).
 *
 * Same confirm-in-onSubmit idiom DeleteButton.tsx/PendingReviewPanel
 * already use — Pause is the one choice here that removes the business
 * from public Findmi, so it gets a confirmation; Restore gets one too
 * (a deliberate, visible state change either way, not a routine save).
 */
export default function BusinessLifecyclePanel({
  status,
  pauseAction,
  restoreAction,
}: {
  status: "live" | "paused";
  pauseAction: () => void | Promise<void>;
  restoreAction: () => void | Promise<void>;
}) {
  if (status === "live") {
    return (
      <div className="mt-3 rounded-2xl border border-black/10 bg-white p-4">
        <p className="text-sm font-semibold text-ink">Live — publicly visible on Findmi.</p>
        <p className="mt-1 text-xs text-ink/50">
          Remove this business from public Findmi without deleting its data. You can restore it later.
        </p>
        <form
          action={pauseAction}
          onSubmit={(e) => {
            if (
              !confirm(
                "Pause this business? It will be removed from public Findmi immediately — you can restore it later."
              )
            ) {
              e.preventDefault();
            }
          }}
          className="mt-3"
        >
          <button
            type="submit"
            className="rounded-full border border-red-200 px-4 py-2 text-xs font-bold uppercase tracking-wide text-red-600 transition hover:bg-red-50"
          >
            Pause Business
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-4">
      <p className="text-sm font-semibold text-amber-900">Paused — hidden from public Findmi.</p>
      <p className="mt-1 text-xs text-amber-800/80">Make this business publicly visible on Findmi again.</p>
      <form
        action={restoreAction}
        onSubmit={(e) => {
          if (!confirm("Restore this business to public Findmi?")) {
            e.preventDefault();
          }
        }}
        className="mt-3"
      >
        <button
          type="submit"
          className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Restore Business
        </button>
      </form>
    </div>
  );
}
