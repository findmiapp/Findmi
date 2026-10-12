"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getAccountSession } from "@/lib/accountSession";
import { ACCOUNT_FOLLOW_ENDPOINT, createFollowToggle, writeAccountFollow, type AccountFollowKind } from "@/lib/account-follow-client";

/** Shared signed-in Follow state for FollowButton / EventFollowButton /
 * LocationFollowButton. Starts from this device's own guest flag
 * (`guestFollowed`), then — once the visitor is known to be signed in —
 * the account's real server state. `toggle()` returns "guest" for a
 * visitor who isn't signed in, so the component runs its own (unchanged)
 * email-capture flow; signed-in taps are explicit, optimistic,
 * single-flight writes (lib/account-follow-client.ts). */
export function useAccountFollow(kind: AccountFollowKind, slug: string, guestFollowed: () => boolean) {
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
    });
  }
  const controller = () => controllerRef.current as ReturnType<typeof createFollowToggle>;

  useEffect(() => {
    setFollowing(guestFollowed());
    let cancelled = false;
    const writesAtStart = controller().writes();
    getAccountSession().then((isAuthed) => {
      if (cancelled || !isAuthed) return;
      setAuthed(true);
      fetch(`${ACCOUNT_FOLLOW_ENDPOINT[kind]}?slug=${encodeURIComponent(slug)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { following?: boolean } | null) => {
          // A tap made meanwhile already holds the newer state.
          if (!cancelled && data && controller().writes() === writesAtStart) setFollowing(Boolean(data.following));
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
    };
    // guestFollowed is read once per entity (it's a localStorage lookup).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, slug, setFollowing]);

  const toggle = useCallback(async () => {
    const result = await (controllerRef.current as ReturnType<typeof createFollowToggle>).toggle();
    if (result.kind === "done") setAuthed(true);
    return result;
  }, []);

  return {
    following,
    authed,
    pending,
    toggle,
    /** The guest email flow succeeded on this device. */
    markGuestFollowing: () => setFollowing(true),
  };
}
