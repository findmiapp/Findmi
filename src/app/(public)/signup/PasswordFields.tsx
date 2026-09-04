"use client";

import { useRef, useState } from "react";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";

/** Password + Confirm Password, sharing one show/hide toggle. Confirm
 * Password has no `name` — it's a client-only check, never submitted to
 * signUp(). Match is enforced via the native Constraint Validation API
 * (setCustomValidity) on the confirm field, so the browser itself blocks
 * the existing action={signUp} submission on mismatch — no onSubmit
 * interception, and SubmitButton's pending/duplicate-submit guard
 * (7c8ad3a) is untouched. */
export default function PasswordFields() {
  const [visible, setVisible] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  function checkMatch() {
    const confirm = confirmRef.current;
    if (!confirm) return;
    const password = passwordRef.current?.value ?? "";
    confirm.setCustomValidity(confirm.value && confirm.value !== password ? "Passwords do not match." : "");
  }

  return (
    <>
      <label className="block">
        <span className="mb-1.5 flex items-center justify-between">
          <span className="text-sm font-medium text-ink">Password</span>
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="text-xs font-semibold text-ink/50 hover:text-ink"
          >
            {visible ? "Hide" : "Show"}
          </button>
        </span>
        <input
          ref={passwordRef}
          type={visible ? "text" : "password"}
          name="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={inputClass}
          onChange={checkMatch}
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink">Confirm Password</span>
        <input
          ref={confirmRef}
          type={visible ? "text" : "password"}
          required
          minLength={8}
          autoComplete="new-password"
          className={inputClass}
          onChange={checkMatch}
        />
      </label>
    </>
  );
}
