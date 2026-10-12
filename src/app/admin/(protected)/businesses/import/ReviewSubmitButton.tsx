"use client";

import { useFormStatus } from "react-dom";

/** Submit button for the candidate review forms — disabled while its
 * form's Server Action runs, so one click submits once. */
export default function ReviewSubmitButton({ label, pendingLabel, primary = false }: { label: string; pendingLabel: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={
        primary
          ? "rounded-2xl bg-findmi px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-60"
          : "rounded-2xl border border-black/15 bg-white px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-ink transition hover:border-black/30 disabled:opacity-60"
      }
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
