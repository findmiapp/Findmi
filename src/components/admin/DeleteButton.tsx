"use client";

export default function DeleteButton({
  action,
  confirmMessage,
  label = "Delete",
}: {
  action: (formData: FormData) => void | Promise<void>;
  confirmMessage: string;
  label?: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(confirmMessage)) e.preventDefault();
      }}
    >
      <button
        type="submit"
        className="rounded-full border border-red-200 px-4 py-2 text-xs font-bold uppercase tracking-wide text-red-600 transition hover:bg-red-50"
      >
        {label}
      </button>
    </form>
  );
}
