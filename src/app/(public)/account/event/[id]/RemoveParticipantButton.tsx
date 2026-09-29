"use client";

/** Launch Stability pass — Destructive Action Safety (P0). Removing a
 * participating Business previously fired with zero confirmation despite
 * being a hard delete: removeParticipatingBusiness (../actions.ts) declines
 * the Business's event-level participation (which itself cancels any
 * linked official-participation Appearance), then permanently deletes the
 * event_businesses roster row. Same smallest-existing-pattern
 * confirm-in-onSubmit idiom as MemberProductActiveButton.tsx /
 * RemoveAppearanceButton.tsx — a native browser confirm(), not a new modal
 * system. Backend behavior is completely unchanged; this only gates
 * whether the form's submit event fires, and names the actual Business,
 * Event, and consequence. */
export default function RemoveParticipantButton({
  action,
  businessName,
  eventName,
}: {
  action: (formData: FormData) => void | Promise<void>;
  businessName: string;
  eventName: string;
}) {
  const message = [
    "Remove this business from the Event?",
    "",
    businessName,
    eventName,
    "",
    "This permanently removes them from the Event roster and withdraws their participation.",
    "Any confirmed appearance they have for this Event will also be removed from their schedule.",
  ].join("\n");

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(message)) {
          e.preventDefault();
        }
      }}
    >
      <button type="submit" className="text-metadata font-semibold text-red-600 hover:text-red-700">
        Remove
      </button>
    </form>
  );
}
