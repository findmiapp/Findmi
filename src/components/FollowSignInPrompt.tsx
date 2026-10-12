"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  accountEntryHrefs,
  followPromptCopy,
  followResumeNext,
  writePendingFollow,
  type AccountFollowKind,
} from "@/lib/account-follow-client";

/** The account prompt every public Follow control opens for a visitor who
 * isn't signed in — Follow is an account relationship. Same bottom sheet
 * (mobile) / centered card (sm+) the Follow controls already used for
 * their former guest email form; one design for Business, Location and
 * Event. Create Free Account / Log In use the existing /signup and /login
 * pages with a safe `next=` back to this page:
 *  - "follow": next carries follow=1 and THIS device records a pending
 *    Follow for this kind + slug (24 h), so the Follow completes once,
 *    on return, signed in (lib/useAccountFollow.ts).
 *  - "legacy": this device already followed as a guest; signing in lets
 *    them manage Following. Nothing is migrated or written here — the
 *    existing sign-in sync handles legacy device follows. */
export default function FollowSignInPrompt({
  kind,
  slug,
  name,
  variant,
  onClose,
}: {
  kind: AccountFollowKind;
  slug: string;
  name: string;
  variant: "follow" | "legacy";
  onClose: () => void;
}) {
  const primaryRef = useRef<HTMLAnchorElement>(null);
  const copy = followPromptCopy(variant, name);
  const { pathname, search } = window.location;
  const next = variant === "follow" ? followResumeNext(pathname, search) : `${pathname}${search}`;
  const hrefs = accountEntryHrefs(next);

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

  function rememberIntent() {
    if (variant !== "follow") return;
    try {
      writePendingFollow(window.localStorage, kind, slug, Date.now());
    } catch {
      // Storage unavailable — after signing in they simply tap Follow.
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
      <div onClick={onClose} className="fixed inset-0 bg-black/40" aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="follow-signin-title"
        aria-describedby="follow-signin-body"
        className="relative w-full rounded-t-3xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-xl sm:max-w-sm sm:rounded-3xl sm:pb-5"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="follow-signin-title" className="font-display text-lg font-bold tracking-tight text-ink">
            {copy.title}
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
        <p id="follow-signin-body" className="mt-1.5 text-sm text-ink/60">
          {copy.body}
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <a
            ref={primaryRef}
            href={hrefs.signup}
            onClick={rememberIntent}
            className="flex h-12 w-full items-center justify-center rounded-2xl bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          >
            Create Free Account
          </a>
          <p className="text-center text-sm text-ink/60">
            Already have an account?{" "}
            <a href={hrefs.login} onClick={rememberIntent} className="font-semibold text-findmi-700 hover:underline">
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
