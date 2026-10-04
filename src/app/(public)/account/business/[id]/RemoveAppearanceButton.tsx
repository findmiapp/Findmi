"use client";

/** Launch Stability pass — Destructive Action Safety (P0). Remove
 * previously fired with zero confirmation, was visually indistinguishable
 * from an "undo my photo" control (it sits directly under the Photo field
 * and Save button in the same edit panel), and — for an appearance
 * representing official Event participation — silently withdrew the
 * business from that Event occurrence as a side effect
 * (reverseSyncEventParticipation, see lib/appearance-event-sync.ts). This
 * incident actually happened in production (illy / A Cup of Love, Sep 29
 * occurrence) before this fix. Same smallest-existing-pattern
 * confirm-in-onSubmit idiom as MemberProductActiveButton.tsx / admin's
 * DeleteButton.tsx — a native browser confirm(), not a new modal system.
 * Backend behavior (removeOwnerAppearance) is completely unchanged; this
 * only gates whether the form's submit event fires, and names exactly
 * what's being removed and what it actually does. */
export default function RemoveAppearanceButton({
  action,
  title,
  dateLabel,
  venueLabel,
  isOfficialParticipation,
}: {
  action: (formData: FormData) => void | Promise<void>;
  title: string;
  dateLabel: string;
  venueLabel: string | null;
  isOfficialParticipation: boolean;
}) {
  const whenWhere = [dateLabel, venueLabel].filter(Boolean).join(" · ");
  const message = [
    "Remove from your Presence?",
    "",
    title,
    whenWhere,
    "",
    "This removes it from your Findmi schedule and public profile.",
    isOfficialParticipation
      ? "\nThis is part of a Findmi event — removing it also withdraws your business from that event date."
      : null,
  ]
    .filter((line) => line !== null)
    .join("\n");

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(message)) {
          e.preventDefault();
        }
      }}
      className="mt-3"
    >
      <button
        type="submit"
        className="rounded-full border border-red-700/20 px-3 py-1.5 text-metadata font-semibold text-red-700/80 transition hover:border-red-700/40 hover:bg-red-50 hover:text-red-700"
      >
        Remove Appearance
      </button>
    </form>
  );
}
