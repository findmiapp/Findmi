"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal, useFormStatus } from "react-dom";

/**
 * Guest-First Creation pass — the submit control for a native creation
 * form (Add A Business / Add A Location) that a signed-out visitor may
 * now reach and fill in directly (see middleware.ts's own carve-out for
 * these exact paths). Authentication only becomes necessary at the
 * actual submit — never before — so this renders two different ways:
 *
 *   authed → the exact same plain `<button type="submit">` this page
 *     always had. Zero behavior change for a signed-in visitor.
 *
 *   guest  → the tap is intercepted; a quiet, contextual sheet explains
 *     why an account is needed now (reusing the same bottom-sheet/
 *     centered-card shell FollowSignInPrompt already uses — one visual
 *     language for "create a free account to continue" across Findmi),
 *     then routes to the existing /signup or /login with a safe `next`
 *     that is THIS exact page with every current field value the
 *     visitor already typed carried as its own query string, plus
 *     `resume=1`. That's exactly what the page's own error-redirect
 *     already does for a rejected submission (errorRedirectUrlWithFields
 *     in lib/admin/form-helpers.ts) — this reuses the same round-trip
 *     shape from the client instead of duplicating it.
 *
 * On return (now signed in, `resume=1` present, every field already
 * restored via the page's own existing defaultValue wiring), this
 * component submits the form itself exactly once — the visitor never
 * has to press the button a second time. Canceling the sheet, a failed
 * sign-in, or navigating away and back all leave the live form exactly
 * as it was: nothing here ever clears or discards what was typed.
 */
export default function GuestCreateSubmit({
  formId,
  label,
  title,
  body,
  authed,
  resume,
  className,
}: {
  formId: string;
  label: string;
  /** Contextual sheet title, e.g. "Your Business Page Is Ready". */
  title: string;
  /** Contextual sheet body, e.g. "Create your free Findmi account to
   * publish it, manage it and keep everything you've created." */
  body: string;
  authed: boolean;
  resume: boolean;
  className: string;
}) {
  const [showSheet, setShowSheet] = useState(false);
  const autoSubmitted = useRef(false);

  useEffect(() => {
    if (!resume || !authed || autoSubmitted.current) return;
    autoSubmitted.current = true;
    // Strip resume/draft params from the visible URL first, so a reload
    // or back-navigation after this point never re-submits.
    const url = new URL(window.location.href);
    url.searchParams.delete("resume");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    (document.getElementById(formId) as HTMLFormElement | null)?.requestSubmit();
  }, [authed, resume, formId]);

  if (authed) return <AuthedSubmit label={label} className={className} />;

  function openSheet(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    setShowSheet(true);
  }

  function draftNext(): string {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    const params = new URLSearchParams();
    if (form) {
      for (const [key, value] of new FormData(form).entries()) {
        if (typeof value === "string" && value) params.set(key, value);
      }
    }
    params.set("resume", "1");
    return `${window.location.pathname}?${params.toString()}`;
  }

  return (
    <>
      <button type="button" onClick={openSheet} className={className}>
        {label}
      </button>
      {showSheet && (
        <GuestCreateSheet title={title} body={body} onClose={() => setShowSheet(false)} draftNext={draftNext} />
      )}
    </>
  );
}

/** The signed-in submit: one submission per tap. Disabled while the create
 * action is in flight (useFormStatus), plus a ref guard for a second tap
 * that lands before that re-render — a double tap must never start a
 * second create. Re-enabled when the action settles (e.g. an error
 * round-trip back to this form). */
function AuthedSubmit({ label, className }: { label: string; className: string }) {
  const { pending } = useFormStatus();
  const submitted = useRef(false);
  useEffect(() => {
    if (!pending) submitted.current = false;
  }, [pending]);
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      onClick={(e) => {
        if (submitted.current) {
          e.preventDefault();
          return;
        }
        // Only a submit the browser will actually send counts (an invalid
        // required field blocks it and must leave the button usable).
        if (e.currentTarget.form?.checkValidity()) submitted.current = true;
      }}
      className={`${className} disabled:opacity-60`}
    >
      {pending ? "Adding…" : label}
    </button>
  );
}

function GuestCreateSheet({
  title,
  body,
  onClose,
  draftNext,
}: {
  title: string;
  body: string;
  onClose: () => void;
  draftNext: () => string;
}) {
  const primaryRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const focusTimer = setTimeout(() => primaryRef.current?.focus(), 50);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      clearTimeout(focusTimer);
    };
  }, [onClose]);

  const next = draftNext();
  const encoded = encodeURIComponent(next);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
      <div onClick={onClose} className="fixed inset-0 bg-black/40" aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="guest-create-title"
        aria-describedby="guest-create-body"
        className="relative w-full rounded-t-3xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-xl sm:max-w-sm sm:rounded-3xl sm:pb-5"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="guest-create-title" className="font-display text-lg font-bold tracking-tight text-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink/50 transition hover:bg-black/[0.03] hover:text-ink"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <p id="guest-create-body" className="mt-1.5 text-sm text-ink/60">
          {body}
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <a
            ref={primaryRef}
            href={`/signup?next=${encoded}`}
            className="flex h-12 w-full items-center justify-center rounded-2xl bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          >
            Create Free Account
          </a>
          <p className="text-center text-sm text-ink/60">
            Already have an account?{" "}
            <a href={`/login?next=${encoded}`} className="font-semibold text-findmi-700 hover:underline">
              Log In
            </a>
          </p>
          <button
            type="button"
            onClick={onClose}
            className="text-center text-xs font-semibold text-ink/50 transition hover:text-ink"
          >
            Not Now
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
