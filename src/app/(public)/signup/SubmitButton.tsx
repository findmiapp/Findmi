"use client";

import { useFormStatus } from "react-dom";

/** useFormStatus only reports pending state from inside the <form>, so the
 * submit button has to be its own component — same pattern as
 * join/PlanCheckoutForm.tsx's SubmitButton and admin/SubmitBar.tsx. Disables
 * immediately on first submit and shows a pending label, so a slow response
 * can't invite a second tap that fires a duplicate signUp() call. */
export default function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex h-12 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? "Creating account…" : "Create Account"}
    </button>
  );
}
