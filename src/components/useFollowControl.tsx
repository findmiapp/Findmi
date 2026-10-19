"use client";

import { useCallback, useRef, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import FollowSignInPrompt from "@/components/FollowSignInPrompt";
import { useAccountFollow } from "@/lib/useAccountFollow";
import { UNFOLLOW_FAILED_MESSAGE, unfollowConfirmCopy, type AccountFollowKind } from "@/lib/account-follow-client";
import { trackEvent } from "@/lib/analytics/track";

/** The behavior every public Follow control shares (Business, Location,
 * Event); each component keeps only its own sizes/visuals.
 *
 *   Not following, signed in → one tap: optimistic Follow (reverted on
 *     failure).
 *   Not following, not signed in → the account prompt (never a guest
 *     email form).
 *   Following, signed in → the Unfollow confirmation. No write until
 *     "Unfollow"; "Keep Following" writes nothing. Success → Follow;
 *     failure → still Following, dialog stays open with the error.
 *   Following on this device as a legacy guest → the account prompt
 *     ("manage your Following"); no guest unfollow, nothing deleted.
 *
 * Every overlay returns focus to the control when it closes. */
export function useFollowControl({
  kind,
  slug,
  name,
  entityId,
  guestFollowed,
  markGuestFollowed,
}: {
  kind: AccountFollowKind;
  slug: string;
  name: string;
  entityId: string;
  guestFollowed: () => boolean;
  /** Guest-First Creation pass — this entity's own per-device Follow
   * marker writer, passed by each concrete button so a signed-out
   * visitor's first Follow tap can succeed silently instead of opening
   * the account prompt. Optional — omitted, this control's guest
   * behavior is unchanged. */
  markGuestFollowed?: () => void;
}) {
  const { following, authed, pending, follow, unfollow, isSignedIn } = useAccountFollow(kind, slug, guestFollowed, markGuestFollowed);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [prompt, setPrompt] = useState<null | "follow" | "legacy">(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  pendingRef.current = pending;

  function track(eventName: "follow" | "unfollow") {
    if (kind === "business") trackEvent({ event_name: eventName, subject_type: "business", subject_id: entityId, business_id: entityId });
    else if (kind === "event") trackEvent({ event_name: eventName, subject_type: "event", subject_id: entityId, event_id: entityId });
    else trackEvent({ event_name: eventName, subject_type: "location", subject_id: entityId, location_id: entityId });
  }

  const refocus = () => buttonRef.current?.focus();

  async function onClick() {
    if (following) {
      // Signed in is resolved on the tap itself — a signed-in visitor's
      // early tap never gets the guest prompt.
      if (await isSignedIn()) {
        setConfirmError(null);
        setConfirming(true);
      } else {
        setPrompt("legacy");
      }
      return;
    }
    const result = await follow();
    if (result.kind === "guest") setPrompt("follow");
    else if (result.kind === "guest-ok") track("follow");
    else if (result.kind === "done" && result.ok) track("follow");
  }

  const closePrompt = useCallback(() => {
    setPrompt(null);
    buttonRef.current?.focus();
  }, []);

  // Stable (reads pending through a ref) so the dialog's own effect
  // doesn't re-run — and steal focus — on every pending/error change.
  const cancelConfirm = useCallback(() => {
    if (pendingRef.current) return;
    setConfirming(false);
    setConfirmError(null);
    buttonRef.current?.focus();
  }, []);

  async function confirmUnfollow() {
    setConfirmError(null);
    const result = await unfollow();
    if (result.kind === "busy") return;
    if (result.kind === "done" && result.ok && !result.following) {
      setConfirming(false);
      track("unfollow");
      refocus();
      return;
    }
    setConfirmError(UNFOLLOW_FAILED_MESSAGE);
  }

  const copy = unfollowConfirmCopy(kind, name);
  const legacyGuest = following && !authed;

  return {
    following,
    authed,
    pending,
    buttonProps: {
      ref: buttonRef,
      type: "button" as const,
      onClick,
      "aria-pressed": authed ? following : undefined,
      "aria-busy": pending || undefined,
      "aria-haspopup": (authed && !following ? undefined : "dialog") as "dialog" | undefined,
      "aria-label": following ? (legacyGuest ? `Following ${name}: log in to manage` : `Unfollow ${name}`) : undefined,
      title: following ? (legacyGuest ? `Following ${name}` : `Following: tap to unfollow ${name}`) : undefined,
    },
    overlays: (
      <>
        {prompt && <FollowSignInPrompt kind={kind} slug={slug} name={name} variant={prompt} onClose={closePrompt} />}
        {confirming && (
          <ConfirmDialog
            title={copy.title}
            message={copy.message}
            cancelLabel="Keep Following"
            confirmLabel="Unfollow"
            pendingLabel="Unfollowing…"
            pending={pending}
            error={confirmError}
            onCancel={cancelConfirm}
            onConfirm={confirmUnfollow}
          />
        )}
      </>
    ),
  };
}
