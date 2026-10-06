"use client";

/** A one-button Server Action form that asks first (native confirm, the
 * same pattern as DeleteButton) — for Archive, which hides an Opportunity
 * but never deletes it. */
export default function ConfirmSubmitButton({
  action,
  confirmMessage,
  label,
  className,
}: {
  action: (formData: FormData) => void | Promise<void>;
  confirmMessage: string;
  label: string;
  className: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(confirmMessage)) e.preventDefault();
      }}
    >
      <button type="submit" className={className}>
        {label}
      </button>
    </form>
  );
}
