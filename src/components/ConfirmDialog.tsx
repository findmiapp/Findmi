"use client";

import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";

/** Findmi's one confirmation dialog (extracted unchanged from
 * SignOutConfirm, which still renders through it): a small centered
 * alertdialog, portaled to <body>, Escape/backdrop = cancel, initial focus
 * on the SAFE action (cancel), a two-button focus trap and background
 * scroll lock. The caller owns open/close state and restores focus to its
 * own trigger when the dialog closes. Used by Sign Out and Unfollow. */
export default function ConfirmDialog({
  title,
  message,
  cancelLabel,
  confirmLabel,
  pendingLabel,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  /** Confirm label while `pending`. */
  pendingLabel: string;
  pending: boolean;
  /** Shown inside the dialog (it stays open) — e.g. a failed request. */
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const messageId = `${id}-message`;

  useEffect(() => {
    cancelRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    // Same "block background scroll while an overlay is open" technique
    // HamburgerMenu's own drawer already uses.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onCancel]);

  // Minimal two-button focus trap — Tab/Shift+Tab cycles between the two
  // actions instead of escaping into the page behind the dialog.
  function onKeyDownTrap(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const first = cancelRef.current;
    const last = confirmRef.current;
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // z-[70] — above every other overlay in the app (HamburgerMenu's own
  // drawer is z-[61], the highest otherwise), since this can open from
  // inside that drawer and must render on top of it rather than behind it.
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} aria-hidden="true" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onKeyDown={onKeyDownTrap}
        className="relative w-full max-w-xs rounded-3xl border border-black/5 bg-white p-5 shadow-xl"
      >
        <h2 id={titleId} className="font-display text-lg font-bold tracking-tight text-ink">
          {title}
        </h2>
        <p id={messageId} className="mt-1.5 text-sm text-ink/60">
          {message}
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-full border border-black/10 px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-black/[0.03] disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="rounded-full border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700 transition hover:bg-red-100 disabled:opacity-60"
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
