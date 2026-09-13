"use client";

import { useFormStatus } from "react-dom";

/** Same pattern as signup/SubmitButton.tsx, join/PlanCheckoutForm.tsx's
 * SubmitButton, and admin/SubmitBar.tsx — useFormStatus only reports
 * pending state from inside the <form>, so this has to be its own
 * component. Disables immediately on first submit so a slow response
 * can't invite a second tap that fires a duplicate inquiry. */
export default function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex h-12 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? "Sending…" : "Send Inquiry"}
    </button>
  );
}
