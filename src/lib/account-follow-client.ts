/** Signed-in Follow for the public Follow controls (Business, Event,
 * Location) and /account/following — framework-free so it can be tested
 * directly; the React binding is lib/useAccountFollow.ts.
 *
 * Follow is an account relationship. A visitor who isn't signed in gets
 * the account prompt (components/FollowSignInPrompt.tsx), never a guest
 * email form; their intent survives sign-up/log-in through the existing
 * safe `next=` return plus a device-bound pending-Follow marker (below).
 * Unfollow is never optimistic: it is confirmed first, and the control
 * only changes once the server has actually removed the follow. */

export type AccountFollowKind = "business" | "event" | "location";

export const ACCOUNT_FOLLOW_ENDPOINT: Record<AccountFollowKind, string> = {
  business: "/api/account/follow",
  event: "/api/account/follow-event",
  location: "/api/account/follow-location",
};

/** POST the DESIRED state (idempotent). Resolves to the server's
 * resulting state, or null on any failure. */
export async function writeAccountFollow(
  kind: AccountFollowKind,
  slug: string,
  following: boolean,
  fetchImpl: typeof fetch = fetch
): Promise<boolean | null> {
  try {
    const res = await fetchImpl(ACCOUNT_FOLLOW_ENDPOINT[kind], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, following }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { following?: unknown };
    return typeof data.following === "boolean" ? data.following : null;
  } catch {
    return null;
  }
}

// ── Controller ────────────────────────────────────────────────────────────

export interface FollowToggleDeps {
  /** Resolves the signed-in state (awaited on every tap, so a tap made
   * before the page's own check finished never takes the guest path for
   * a signed-in visitor). */
  isSignedIn: () => Promise<boolean>;
  write: (desired: boolean) => Promise<boolean | null>;
  get: () => boolean;
  set: (following: boolean) => void;
  setPending: (pending: boolean) => void;
  /** Guest-First Creation pass — a device-local "has this device followed
   * X" marker (lib/followed.ts and its Event/Location siblings), the same
   * per-device write every legacy guest Follow already left behind. Only
   * called for a NEW Follow tap (never Unfollow — a guest who hasn't
   * signed in has no account relationship to remove); when present, a
   * first-time guest Follow succeeds silently instead of opening the
   * account prompt. Omitted entirely, this control's guest behavior is
   * unchanged (`{ kind: "guest" }`, prompt shown) — existing callers that
   * haven't been updated keep working exactly as before. */
  markGuestFollowed?: () => void;
}

export type FollowResult = { kind: "guest" } | { kind: "guest-ok" } | { kind: "busy" } | { kind: "done"; ok: boolean; following: boolean };

/** One control's writes: one request in flight at a time (extra taps are
 * ignored, never queued).
 *  - follow(): optimistic — shows Following at once, reverts on failure.
 *  - unfollow(): NOT optimistic — the caller has already confirmed; the
 *    state only changes after the server confirms the removal. */
export function createFollowToggle(deps: FollowToggleDeps) {
  let inFlight = false;
  let writes = 0;

  async function run(desired: boolean, optimistic: boolean): Promise<FollowResult> {
    if (inFlight) return { kind: "busy" };
    inFlight = true;
    try {
      if (!(await deps.isSignedIn())) {
        if (desired && deps.markGuestFollowed) {
          deps.markGuestFollowed();
          deps.set(true);
          return { kind: "guest-ok" };
        }
        return { kind: "guest" };
      }
      const before = deps.get();
      writes += 1;
      deps.setPending(true);
      if (optimistic) deps.set(desired);
      let server: boolean | null;
      try {
        server = await deps.write(desired);
      } catch {
        server = null;
      }
      if (server === null) {
        if (optimistic) deps.set(before);
        return { kind: "done", ok: false, following: before };
      }
      deps.set(server);
      return { kind: "done", ok: true, following: server };
    } finally {
      inFlight = false;
      deps.setPending(false);
    }
  }

  return {
    /** Writes started so far — a slower initial state read must not
     * overwrite a state the visitor has already changed. */
    writes: () => writes,
    follow: () => run(true, true),
    unfollow: () => run(false, false),
  };
}

// ── Pending Follow across sign-up / log-in ────────────────────────────────
//
// When a visitor who isn't signed in taps Follow and chooses Create Free
// Account / Log In, this DEVICE records { intent: "follow", kind, slug,
// at }, and the existing safe `next=` return carries `follow=1` back to
// the same page. The Follow is completed only when ALL hold: the visitor
// is signed in, the page carries follow=1, AND this device holds an
// unexpired marker for exactly this kind + slug. The marker is claimed
// (removed) before the single attempt, so a page with the entity twice —
// or a reload — never writes twice and a failure never loops. A crafted
// `?follow=1` link by itself (no marker on this device) never follows
// anything; an expired or malformed marker is cleared and ignored.

export const PENDING_FOLLOW_KEY = "findmi_pending_follow_v1";
export const PENDING_FOLLOW_TTL_MS = 24 * 60 * 60 * 1000;
export const FOLLOW_RESUME_PARAM = "follow";
/** A marker dated this far in the future (clock skew) is still invalid. */
const FUTURE_SKEW_MS = 5 * 60 * 1000;

export interface FollowStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface PendingFollow {
  v: 1;
  intent: "follow";
  kind: AccountFollowKind;
  slug: string;
  at: number;
}

export function writePendingFollow(storage: FollowStorage, kind: AccountFollowKind, slug: string, now: number): void {
  try {
    const marker: PendingFollow = { v: 1, intent: "follow", kind, slug, at: now };
    storage.setItem(PENDING_FOLLOW_KEY, JSON.stringify(marker));
  } catch {
    // Storage unavailable — after signing in they simply tap Follow.
  }
}

function readPendingFollow(storage: FollowStorage): PendingFollow | "invalid" | null {
  let raw: string | null;
  try {
    raw = storage.getItem(PENDING_FOLLOW_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const m = JSON.parse(raw) as Partial<PendingFollow>;
    const kinds: AccountFollowKind[] = ["business", "event", "location"];
    if (
      m &&
      m.v === 1 &&
      m.intent === "follow" &&
      typeof m.kind === "string" &&
      kinds.includes(m.kind as AccountFollowKind) &&
      typeof m.slug === "string" &&
      m.slug.length > 0 &&
      m.slug.length <= 200 &&
      typeof m.at === "number" &&
      Number.isFinite(m.at)
    ) {
      return m as PendingFollow;
    }
  } catch {
    // fall through
  }
  return "invalid";
}

/** Claims the pending Follow for THIS entity: true only for a valid,
 * unexpired (≤ 24 h), kind + slug matching marker — which is removed
 * here, before any write. Expired/malformed markers are removed and
 * ignored; a valid marker for another entity is left for that entity's
 * own control. */
export function takePendingFollow(storage: FollowStorage, kind: AccountFollowKind, slug: string, now: number): boolean {
  const marker = readPendingFollow(storage);
  if (marker === null) return false;
  const clear = () => {
    try {
      storage.removeItem(PENDING_FOLLOW_KEY);
    } catch {
      // ignore
    }
  };
  if (marker === "invalid") {
    clear();
    return false;
  }
  const age = now - marker.at;
  if (age > PENDING_FOLLOW_TTL_MS || age < -FUTURE_SKEW_MS) {
    clear();
    return false;
  }
  if (marker.kind !== kind || marker.slug !== slug) return false;
  clear();
  return true;
}

/** True when the page was reached with the Follow-resume parameter. */
export function hasFollowResume(search: string): boolean {
  return new URLSearchParams(search).get(FOLLOW_RESUME_PARAM) === "1";
}

/** Where sign-up/log-in should return: this page (path + its existing
 * query) with follow=1. Fed through the existing getSafeRedirect by the
 * login/signup pages. */
export function followResumeNext(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.set(FOLLOW_RESUME_PARAM, "1");
  return `${pathname}?${params.toString()}`;
}

/** This page without the resume parameter (other params + hash kept), or
 * null when it isn't present. */
export function withoutFollowResume(pathname: string, search: string, hash: string): string | null {
  const params = new URLSearchParams(search);
  if (!params.has(FOLLOW_RESUME_PARAM)) return null;
  params.delete(FOLLOW_RESUME_PARAM);
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}${hash}`;
}

/** The existing sign-up / log-in entry points with a safe relative next. */
export function accountEntryHrefs(next: string): { signup: string; login: string } {
  const encoded = encodeURIComponent(next);
  return { signup: `/signup?next=${encoded}`, login: `/login?next=${encoded}` };
}

// ── Copy ──────────────────────────────────────────────────────────────────

/** Unfollow confirmation — describes only what Follow does today (the
 * Following list and the personal Findmi schedule); no notifications. */
export function unfollowConfirmCopy(kind: AccountFollowKind, name: string): { title: string; message: string } {
  const consequence =
    kind === "business"
      ? "its upcoming appearances won't show in your Findmi schedule"
      : kind === "location"
        ? "what's happening there won't show in your Findmi schedule"
        : "its dates won't show in your Findmi schedule";
  return {
    title: `Unfollow ${name}?`,
    message: `${name} will be removed from your Following list, and ${consequence}.`,
  };
}

export const UNFOLLOW_FAILED_MESSAGE = "Couldn't unfollow. Please try again.";

/** Account prompt copy: a new Follow, or a device that already followed
 * as a guest (managing Following needs an account). */
export function followPromptCopy(variant: "follow" | "legacy", name: string): { title: string; body: string } {
  if (variant === "legacy") {
    return {
      title: `Following ${name}`,
      body: `You followed ${name} on this device. Create a free Findmi account or log in to manage the brands, places and events you follow on Findmi.`,
    };
  }
  return {
    title: `Follow ${name} on Findmi`,
    body: "Create a free Findmi account to follow the brands, places and events you care about and keep your discoveries together.",
  };
}
