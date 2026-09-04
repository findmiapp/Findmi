"use client";

/** Product Management Completion pass — Deactivate now requires
 * confirmation before it fires; Reactivate stays a plain one-click action
 * (nothing destructive to confirm). Same smallest-existing-pattern
 * confirm-in-onSubmit idiom already used by admin/DeleteButton.tsx — a
 * native browser confirm(), not a new modal system. Backend behavior
 * (setMemberProductActive) is completely unchanged; this only gates
 * whether the form's submit event fires. */
export default function MemberProductActiveButton({
  action,
  isActive,
}: {
  action: (formData: FormData) => void | Promise<void>;
  isActive: boolean;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (
          isActive &&
          !confirm(
            "Deactivate This Product?\n\nThis Will Remove It From Public View Until You Reactivate It. Nothing Will Be Deleted."
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        className={`shrink-0 text-xs font-semibold hover:underline ${isActive ? "text-red-600" : "text-findmi-700"}`}
      >
        {isActive ? "Deactivate" : "Reactivate"}
      </button>
    </form>
  );
}
