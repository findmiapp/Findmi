"use client";

import { useFormStatus } from "react-dom";

/** useFormStatus only reports pending state from inside the <form>, so the
 * submit button has to be its own component — same pattern as
 * join/PlanCheckoutForm.tsx's SubmitButton and admin/SubmitBar.tsx. Disables
 * immediately on first submit and shows a pending label, so a slow response
 * can't invite a second tap that fires a duplicate signUp() call.
 *
 * Signup/Email Confirmation Hardening pass — `disabled` is an additional,
 * optional flag SignupForm.tsx sets while a KNOWN, already-typed value
 * conflicts (mismatched emails/passwords, an unmistakably invalid phone) —
 * pure UX, never the authoritative check (signUp() in actions.ts still
 * re-validates everything server-side regardless of this button's state).
 */
export default function SubmitButton({ disabled = false }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="flex h-12 w-full items-center justify-center rounded-2xl bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? "Creating account…" : "Create Account"}
    </button>
  );
}
