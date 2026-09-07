"use client";

import { useState, type FormEvent } from "react";
import PasswordField from "@/components/PasswordField";
import SubmitButton from "./SubmitButton";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";

/**
 * Signup + Email Confirmation UX Correction pass — Confirm Email/Confirm
 * Password (Sections 2-3): matched client-side here BEFORE the real
 * server action ever runs (Cases A/B — "no Supabase signup request" on a
 * mismatch), via a plain onSubmit check on the same real
 * `<form action={signUp}>` — preventDefault() on a mismatch stops the
 * Server Action from firing at all, exactly like blocking a normal form
 * submit. This is progressive enhancement, not the authoritative check:
 * signUp() (actions.ts) re-validates both matches server-side
 * unconditionally, since a JS-disabled or scripted client can always
 * skip this component entirely.
 */
export default function SignupForm({
  action,
  next,
  defaultDisplayName,
  defaultEmail,
}: {
  action: (formData: FormData) => void;
  next: string;
  defaultDisplayName?: string;
  defaultEmail?: string;
}) {
  const [clientError, setClientError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value.trim();
    const confirmEmail = (form.elements.namedItem("confirm_email") as HTMLInputElement).value.trim();
    const password = (form.elements.namedItem("password") as HTMLInputElement).value;
    const confirmPassword = (form.elements.namedItem("confirm_password") as HTMLInputElement).value;

    if (email !== confirmEmail) {
      e.preventDefault();
      setClientError("Email addresses don't match.");
      return;
    }
    if (password !== confirmPassword) {
      e.preventDefault();
      setClientError("Passwords don't match.");
      return;
    }
    setClientError(null);
  }

  return (
    <form action={action} onSubmit={handleSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink">Name</span>
        <input type="text" name="display_name" defaultValue={defaultDisplayName} autoComplete="name" className={inputClass} />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink">Email</span>
        <input type="email" name="email" required defaultValue={defaultEmail} autoComplete="email" className={inputClass} />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink">Confirm email</span>
        <input type="email" name="confirm_email" required autoComplete="email" className={inputClass} />
      </label>
      <PasswordField name="password" label="Password" autoComplete="new-password" minLength={8} />
      <PasswordField name="confirm_password" label="Confirm password" autoComplete="new-password" minLength={8} />

      {clientError && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{clientError}</p>
      )}

      <div className="mt-1">
        <SubmitButton />
      </div>
    </form>
  );
}
