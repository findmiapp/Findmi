"use client";

import { useRef } from "react";
import { TextField } from "@/components/admin/Fields";

/** Confirmation gate before submitting an admin-entered password, same
 * window.confirm() pattern components/admin/OwnershipActions.tsx already
 * uses for other admin-privileged actions. Clears the field after a
 * successful submit (a fresh mount after the redirect this Server Action
 * issues) — see the ref-reset below, which only matters on a client-side
 * re-render; a full page redirect already clears it for free, this just
 * covers back/forward-cache restores of the same form. */
export default function SetPasswordForm({ action }: { action: (formData: FormData) => void }) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={action}
      onSubmit={(e) => {
        const confirmed = window.confirm(
          "Set a new password for this user?\n\nThey'll need to use it (not their old one) next time they sign in. Tell them to change it after logging in."
        );
        if (!confirmed) {
          e.preventDefault();
          return;
        }
        // Best-effort clear on the client too — the redirect this action
        // issues on success already unmounts/remounts this form with a
        // fresh empty value in the normal case.
        requestAnimationFrame(() => formRef.current?.reset());
      }}
      className="flex flex-col gap-3"
    >
      <TextField
        label="New password"
        name="password"
        type="password"
        required
        hint="At least 8 characters. Never shown again after this — tell the user to change it after logging in."
      />
      <button
        type="submit"
        className="w-fit rounded-full border border-black/10 px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink transition hover:bg-black/[0.03]"
      >
        Set New Password
      </button>
    </form>
  );
}
