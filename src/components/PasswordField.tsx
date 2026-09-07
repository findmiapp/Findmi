"use client";

import { useState } from "react";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 pr-11 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";

/**
 * Signup + Email Confirmation UX Correction pass — the smallest reusable
 * show/hide password field: an uncontrolled <input> (never touches the
 * typed value, only its `type`) plus one toggle button. No dependency,
 * no shared visibility state across instances — Password and Confirm
 * Password each get their own independent show/hide (Case C).
 */
export default function PasswordField({
  name,
  label,
  autoComplete,
  minLength,
  required = true,
}: {
  name: string;
  label: string;
  autoComplete?: string;
  minLength?: number;
  required?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      <div className="relative">
        <input
          type={visible ? "text" : "password"}
          name={name}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          className={inputClass}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-ink/40 transition hover:text-ink/70"
        >
          {visible ? <EyeOffGlyph /> : <EyeGlyph />}
        </button>
      </div>
    </label>
  );
}

function EyeGlyph() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px]">
      <path
        d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.25" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function EyeOffGlyph() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px]">
      <path
        d="M2.5 2.5l15 15M8.2 8.35a2.25 2.25 0 003.1 3.1M6.1 6.15C3.9 7.4 2.3 10 1.5 10c0 0 3 6 8.5 6 1.55 0 2.85-.47 3.9-1.1M15.9 13.9C17.4 12.55 18.5 10 18.5 10s-3-6-8.5-6c-.5 0-.98.05-1.42.14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
