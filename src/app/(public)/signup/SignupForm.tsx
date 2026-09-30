"use client";

import { useState, type FormEvent } from "react";
import PasswordField from "@/components/PasswordField";
import { normalizeUsPhone } from "@/lib/phone";
import SubmitButton from "./SubmitButton";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";
const errorTextClass = "mt-1 text-xs text-red-600";
const validTextClass = "mt-1 text-xs text-findmi-700";

// A deliberately simple, permissive syntax check (something@something.tld)
// — just enough to catch an obvious typo before the server ever sees it.
// Never the authoritative check: signUp() in actions.ts still hands the
// exact typed value straight to supabase.auth.signUp(), which is the real
// validation. Never used to look up whether an account exists for this
// address — see this file's own doc comment below.
const EMAIL_SYNTAX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
 *
 * Signup/Email Confirmation Hardening pass — every field below is now
 * CONTROLLED (was uncontrolled with defaultValue) so it can show a live,
 * per-field helper/error state as the visitor types/blurs, in addition to
 * the existing submit-time guard (kept as a defense-in-depth fallback,
 * e.g. for a fast Enter-key submit before React re-renders). None of this
 * is, or calls, a new account/phone-existence lookup: every check here
 * is pure client-side syntax/format/match logic (normalizeUsPhone() is
 * the exact same pure function actions.ts uses server-side — no second
 * normalization system), never a network request, and never reveals
 * whether a given email/phone already has a FindMi account. Server-side
 * validation in actions.ts remains completely unchanged and authoritative
 * — this file only makes the known-bad cases it already re-checks visible
 * sooner, so a submission doesn't have to round-trip to the server to
 * discover a typo it could already see locally.
 */
export default function SignupForm({
  action,
  next,
  defaultDisplayName,
  defaultEmail,
  defaultPhone,
}: {
  action: (formData: FormData) => void;
  next: string;
  defaultDisplayName?: string;
  defaultEmail?: string;
  defaultPhone?: string;
}) {
  const [displayName, setDisplayName] = useState(defaultDisplayName ?? "");
  const [displayNameTouched, setDisplayNameTouched] = useState(false);

  const [email, setEmail] = useState(defaultEmail ?? "");
  const [emailTouched, setEmailTouched] = useState(false);

  const [confirmEmail, setConfirmEmail] = useState("");
  const [confirmEmailTouched, setConfirmEmailTouched] = useState(false);

  const [phone, setPhone] = useState(defaultPhone ?? "");
  const [phoneTouched, setPhoneTouched] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmPasswordTouched, setConfirmPasswordTouched] = useState(false);

  const [clientError, setClientError] = useState<string | null>(null);

  const emailTrimmed = email.trim();
  const emailSyntaxOk = emailTrimmed.length === 0 || EMAIL_SYNTAX.test(emailTrimmed);
  const showEmailError = emailTouched && emailTrimmed.length > 0 && !emailSyntaxOk;
  const showDisplayNameError = displayNameTouched && displayName.trim().length === 0;

  const confirmEmailMismatch = confirmEmail.length > 0 && emailTrimmed !== confirmEmail.trim();
  const showConfirmEmailError = confirmEmailTouched && confirmEmail.length > 0 && confirmEmailMismatch;
  const showConfirmEmailValid =
    confirmEmailTouched && confirmEmail.length > 0 && !confirmEmailMismatch && emailSyntaxOk;

  const phoneNormalized = phone.trim().length > 0 ? normalizeUsPhone(phone) : null;
  const showPhoneError = phoneTouched && phone.trim().length > 0 && !phoneNormalized;

  // The one real, deterministic, client-checkable password rule — matches
  // both PasswordField's own minLength={8} and signUp()'s own
  // `password.length < 8` check exactly. Supabase's own project-level
  // password policy (e.g. leaked-password protection) can reject a
  // password that passes this check too — that's only ever discoverable
  // server-side (see signup/actions.ts's weak_password handling), so it's
  // never invented or simulated here.
  const passwordLengthOk = password.length >= 8;

  const confirmPasswordMismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const showConfirmPasswordError = confirmPasswordTouched && confirmPassword.length > 0 && confirmPasswordMismatch;
  const showConfirmPasswordValid = confirmPasswordTouched && confirmPassword.length > 0 && !confirmPasswordMismatch;

  // Only ever blocks on a value the visitor has actually typed and that
  // is KNOWN to be bad — never on a field simply being empty so far (the
  // input's own `required` attribute already handles that natively on
  // submit, via the browser's own validation UI).
  const hasBlockingIssue =
    (emailTrimmed.length > 0 && !emailSyntaxOk) ||
    (confirmEmail.length > 0 && confirmEmailMismatch) ||
    (phone.trim().length > 0 && !phoneNormalized) ||
    (password.length > 0 && !passwordLengthOk) ||
    (confirmPassword.length > 0 && confirmPasswordMismatch);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    if (emailTrimmed !== confirmEmail.trim()) {
      e.preventDefault();
      setClientError("Email addresses don't match.");
      return;
    }
    if (phone.trim().length > 0 && !normalizeUsPhone(phone)) {
      e.preventDefault();
      setClientError("Enter a valid U.S. or Canada cell number.");
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
        <span className="mb-1.5 block text-sm font-medium text-ink">Full Name</span>
        <input
          type="text"
          name="display_name"
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          onBlur={() => setDisplayNameTouched(true)}
          autoComplete="name"
          className={inputClass}
        />
        {showDisplayNameError && <p className={errorTextClass}>Enter your full name.</p>}
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink">Email</span>
        <input
          type="email"
          name="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setEmailTouched(true)}
          autoComplete="email"
          className={inputClass}
        />
        {showEmailError && <p className={errorTextClass}>Enter a valid email address.</p>}
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink">Confirm email</span>
        <input
          type="email"
          name="confirm_email"
          required
          value={confirmEmail}
          onChange={(e) => setConfirmEmail(e.target.value)}
          onBlur={() => setConfirmEmailTouched(true)}
          autoComplete="email"
          className={inputClass}
        />
        {showConfirmEmailError && <p className={errorTextClass}>Email addresses don&rsquo;t match.</p>}
        {!showConfirmEmailError && showConfirmEmailValid && <p className={validTextClass}>Emails match.</p>}
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink">Cell Number</span>
        <input
          type="tel"
          name="phone"
          required
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={() => setPhoneTouched(true)}
          autoComplete="tel"
          placeholder="(917) 555-1234"
          className={inputClass}
        />
        <span className="mt-1 block text-xs text-ink/45">Used for important account updates, never shared publicly.</span>
        {showPhoneError && <p className={errorTextClass}>Enter a valid U.S. or Canada cell number.</p>}
      </label>

      <div>
        <PasswordField
          name="password"
          label="Password"
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {password.length > 0 && (
          <p className={`mt-1 text-xs ${passwordLengthOk ? "text-findmi-700" : "text-ink/45"}`}>
            {passwordLengthOk ? "✓ " : ""}At least 8 characters
          </p>
        )}
      </div>
      <div>
        <PasswordField
          name="confirm_password"
          label="Confirm password"
          autoComplete="new-password"
          minLength={8}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          onBlur={() => setConfirmPasswordTouched(true)}
        />
        {showConfirmPasswordError && <p className={errorTextClass}>Passwords don&rsquo;t match.</p>}
        {!showConfirmPasswordError && showConfirmPasswordValid && <p className={validTextClass}>Passwords match.</p>}
      </div>

      {clientError && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{clientError}</p>
      )}

      <div className="mt-1">
        <SubmitButton disabled={hasBlockingIssue} />
      </div>
    </form>
  );
}
