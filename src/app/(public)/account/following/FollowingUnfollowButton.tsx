"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/ConfirmDialog";
import { ACCOUNT_FOLLOW_ENDPOINT, UNFOLLOW_FAILED_MESSAGE, unfollowConfirmCopy } from "@/lib/account-follow-client";

/** Small overlay "×" on each card in /account/following. Opens the same
 * Unfollow confirmation as the public Follow controls; nothing is written
 * until "Unfollow", which sends the explicit desired state
 * `following: false` — never the legacy toggle — so a stale page can
 * never re-follow anything. The card hides only once the server confirms
 * (router.refresh() then re-runs the page's own query); a failure keeps
 * the dialog open with the error and the card in place. */
export default function FollowingUnfollowButton({
  kind,
  slug,
  name,
}: {
  kind: "business" | "event" | "location";
  slug: string;
  /** For the dialog copy and the accessible label. */
  name: string;
}) {
  const [hidden, setHidden] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pendingRef = useRef(false);
  const router = useRouter();

  const cancel = useCallback(() => {
    if (pendingRef.current) return;
    setConfirming(false);
    setError(null);
    triggerRef.current?.focus();
  }, []);

  async function confirmUnfollow() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    let ok = false;
    try {
      const res = await fetch(ACCOUNT_FOLLOW_ENDPOINT[kind], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, following: false }),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    pendingRef.current = false;
    setPending(false);
    if (!ok) {
      setError(UNFOLLOW_FAILED_MESSAGE);
      return;
    }
    setConfirming(false);
    setHidden(true);
    router.refresh();
  }

  if (hidden) return null;
  const copy = unfollowConfirmCopy(kind, name);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Unfollow ${name}`}
        aria-haspopup="dialog"
        title={`Unfollow ${name}`}
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
        className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition hover:bg-black/70 disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      {confirming && (
        <ConfirmDialog
          title={copy.title}
          message={copy.message}
          cancelLabel="Keep Following"
          confirmLabel="Unfollow"
          pendingLabel="Unfollowing…"
          pending={pending}
          error={error}
          onCancel={cancel}
          onConfirm={confirmUnfollow}
        />
      )}
    </>
  );
}
