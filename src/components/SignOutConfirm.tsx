"use client";

import { useRef, useState, type ReactNode } from "react";
import ConfirmDialog from "./ConfirmDialog";

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
      {open && (
        <ConfirmDialog
          title="Sign out?"
          message="Are you sure you want to sign out of Findmi?"
          cancelLabel="Cancel"
          confirmLabel="Sign Out"
          pendingLabel="Signing Out…"
          pending={pending}
          onCancel={close}
          onConfirm={confirmSignOut}
        />
      )}
    </>
  );
}
