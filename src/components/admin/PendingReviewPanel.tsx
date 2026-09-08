"use client";

/**
 * Admin Pending Review Decision UX pass — one shared panel for the
 * Business and Event edit pages: a prominent, unmissable Approve/Reject
 * decision UI, shown ONLY while the entity's own authoritative moderation
 * state is still pending, so an admin never has to hunt through tabs to
 * find the decision (see each caller's own placement — above its tab
 * content, not inside any one tab).
 *
 * Reject asks for confirmation (same confirm-in-onSubmit idiom
 * DeleteButton.tsx already uses) since it's the one choice here that
 * feels irreversible; Approve does not, matching every other admin "Save"
 * action's own lack of a confirm step. rejectAction is optional — a caller
 * without a real reject action (or that wants an explanatory line instead)
 * can pass rejectNote, which renders in place of a second button.
 */
export default function PendingReviewPanel({
  entityLabel,
  context,
  approveAction,
  approveLabel,
  rejectAction,
  rejectNote,
}: {
  entityLabel: string;
  context?: string;
  approveAction: () => void | Promise<void>;
  approveLabel: string;
  rejectAction?: () => void | Promise<void>;
  rejectNote?: string;
}) {
  return (
    <div className="mt-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-amber-800">Pending Review</p>
      <p className="mt-1 text-sm font-medium text-amber-900">This {entityLabel} is waiting for an Admin decision.</p>
      {context && <p className="mt-1 text-xs text-amber-700">{context}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <form action={approveAction}>
          <button
            type="submit"
            className="rounded-full bg-findmi px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          >
            {approveLabel}
          </button>
        </form>
        {rejectAction && (
          <form
            action={rejectAction}
            onSubmit={(e) => {
              if (!confirm(`Reject this ${entityLabel.toLowerCase()}? It will stay hidden from the public.`)) {
                e.preventDefault();
              }
            }}
          >
            <button
              type="submit"
              className="rounded-full border border-red-200 bg-white px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-red-600 transition hover:bg-red-50"
            >
              Reject
            </button>
          </form>
        )}
        {!rejectAction && rejectNote && <p className="text-xs text-amber-700">{rejectNote}</p>}
      </div>
    </div>
  );
}
