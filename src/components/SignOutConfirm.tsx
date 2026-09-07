"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Sitewide Sign-Out Confirmation pass — one small, reusable wrapper
 * around every logout/sign-out trigger in the app (consumer AccountNav/
 * Profile/mobile drawer, founder /admin header), so an accidental tap
 * can never immediately end a session. Renders the exact same trigger
 * markup each call site already had (via `className`/`children`/
 * `ariaLabel`) — this only changes what a click DOES (open a confirm
 * dialog instead of submitting immediately), never how the trigger
 * looks. Confirming calls the real, already-existing sign-out Server
 * Action directly — works identically whether it's account/profile's
 * consumer `signOut` or admin's `logout`; this pass never touches
 * either implementation, both still just clear their own session and
 * redirect exactly as before. No second auth system, no new session
 * logic, no new post-logout destination. */
export default function SignOutConfirm({
  action,
  className,
  ariaLabel,
  children,
}: {
  /** The existing sign-out Server Action itself (e.g. account/profile's
   * `signOut`, admin login's `logout`) — called directly, the same way
   * Next.js already supports invoking a Server Action from an event
   * handler instead of only via a <form action>. Its own redirect()
   * still fires exactly as before. */
  action: () => Promise<void>;
  className?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    // The dialog is about to unmount — restore focus to the trigger
    // rather than letting it fall back to <body>, so a keyboard user
    // who cancels isn't left with no visible focus at all.
    triggerRef.current?.focus();
  }

  async function confirmSignOut() {
    setPending(true);
    // action()'s own redirect() throws a special error the framework
    // intercepts to navigate — never caught/swallowed here.
    await action();
  }

  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)} aria-label={ariaLabel} className={className}>
        {children}
      </button>
      {open && <ConfirmDialog pending={pending} onCancel={close} onConfirm={confirmSignOut} />}
    </>
  );
}

function ConfirmDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

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

  // Minimal two-button focus trap — Tab/Shift+Tab cycles between Cancel
  // and Sign Out instead of escaping into the page behind the dialog.
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
  // inside that drawer (the mobile utility strip's Log out icon) and
  // must render on top of it rather than behind it.
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} aria-hidden="true" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sign-out-confirm-title"
        aria-describedby="sign-out-confirm-message"
        onKeyDown={onKeyDownTrap}
        className="relative w-full max-w-xs rounded-3xl border border-black/5 bg-white p-5 shadow-xl"
      >
        <h2 id="sign-out-confirm-title" className="font-display text-lg font-bold tracking-tight text-ink">
          Sign out?
        </h2>
        <p id="sign-out-confirm-message" className="mt-1.5 text-sm text-ink/60">
          Are you sure you want to sign out of Findmi?
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-full border border-black/10 px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-black/[0.03] disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="rounded-full border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700 transition hover:bg-red-100 disabled:opacity-60"
          >
            {pending ? "Signing Out…" : "Sign Out"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
