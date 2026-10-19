"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getAccountSession } from "@/lib/accountSession";
import {
  ACCOUNT_FOLLOW_ENDPOINT,
  createFollowToggle,
  hasFollowResume,
  takePendingFollow,
  withoutFollowResume,
  writeAccountFollow,
  type AccountFollowKind,
} from "@/lib/account-follow-client";

/** Shared signed-in Follow state for FollowButton / EventFollowButton /
 * LocationFollowButton. Starts from this device's own legacy guest flag
 * (`guestFollowed`), then — once the visitor is known to be signed in —
 * the account's real server state.
 *
 * follow(): one tap, optimistic, reverted on failure; "guest" for a
 * visitor who isn't signed in (the component opens the account prompt).
 * unfollow(): only after the component's confirmation; waits for the
 * server. Returning from sign-up/log-in with follow=1 completes a pending
 * Follow ONCE when this device holds a matching, unexpired marker
 * (lib/account-follow-client.ts) — never from the URL alone.
 *
 * Guest-First Creation pass — `markGuestFollowed`, when passed, is this
 * entity's own per-device "has this device followed X" writer
 * (lib/followed.ts / followedEvents.ts / followedLocations.ts): a
 * signed-out visitor's first Follow tap then succeeds silently (no
 * account prompt) instead of being blocked, same guest-first posture
 * Save already has. Omitted, a guest tap behaves exactly as before. */
export function useAccountFollow(
  kind: AccountFollowKind,
  slug: string,
  guestFollowed: () => boolean,
  markGuestFollowed?: () => void
) {
  const [following, setFollowingState] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [pending, setPending] = useState(false);
  const followingRef = useRef(false);

  const setFollowing = useCallback((value: boolean) => {
    followingRef.current = value;
    setFollowingState(value);
  }, []);

  const slugRef = useRef(slug);
  slugRef.current = slug;

  const markGuestFollowedRef = useRef(markGuestFollowed);
  markGuestFollowedRef.current = markGuestFollowed;

  // Created once per control (lazily — never a throwaway per render), so
  // its single-flight guard spans every tap on this control.
  const controllerRef = useRef<ReturnType<typeof createFollowToggle> | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createFollowToggle({
      isSignedIn: () => getAccountSession(),
      write: (desired) => writeAccountFollow(kind, slugRef.current, desired),
      get: () => followingRef.current,
      set: (value) => setFollowing(value),
      setPending: (value) => setPending(value),
      markGuestFollowed: markGuestFollowedRef.current ? () => markGuestFollowedRef.current!() : undefined,
    });
  }
  const controller = () => controllerRef.current as ReturnType<typeof createFollowToggle>;

  useEffect(() => {
    setFollowing(guestFollowed());
    // Captured synchronously at mount — before any control on the page
    // removes the parameter from the URL.
    const resume = typeof window !== "undefined" && hasFollowResume(window.location.search);
    let cancelled = false;
    const writesAtStart = controller().writes();
    getAccountSession().then(async (isAuthed) => {
      if (cancelled || !isAuthed) return;
      setAuthed(true);
      try {
        const res = await fetch(`${ACCOUNT_FOLLOW_ENDPOINT[kind]}?slug=${encodeURIComponent(slug)}`);
        const data = res.ok ? ((await res.json()) as { following?: boolean }) : null;
        // A tap made meanwhile already holds the newer state.
        if (!cancelled && data && controller().writes() === writesAtStart) setFollowing(Boolean(data.following));
      } catch {
        // Keep the current state.
      }
      if (cancelled || !resume) return;
      // Pending Follow from before sign-up/log-in: claimed (removed) before
      // the single attempt; never retried, so a failure can't loop.
      let claimed = false;
      try {
        claimed = takePendingFollow(window.localStorage, kind, slug, Date.now());
      } catch {
        claimed = false;
      }
      const clean = withoutFollowResume(window.location.pathname, window.location.search, window.location.hash);
      if (clean !== null) window.history.replaceState(window.history.state, "", clean);
      if (claimed && !followingRef.current) await controller().follow();
    });
    return () => {
      cancelled = true;
    };
    // guestFollowed is read once per entity (it's a localStorage lookup).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, slug, setFollowing]);

  const follow = useCallback(async () => {
    const result = await (controllerRef.current as ReturnType<typeof createFollowToggle>).follow();
    if (result.kind === "done") setAuthed(true);
    return result;
  }, []);

  const unfollow = useCallback(async () => {
    const result = await (controllerRef.current as ReturnType<typeof createFollowToggle>).unfollow();
    if (result.kind === "done") setAuthed(true);
    return result;
  }, []);

  return {
    following,
    authed,
    pending,
    follow,
    unfollow,
    /** Resolves the signed-in state (cached per page load). */
    isSignedIn: getAccountSession,
  };
}
