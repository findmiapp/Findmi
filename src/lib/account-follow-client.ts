/** Signed-in Follow state for the public Follow controls (Business,
 * Event, Location) — framework-free so it can be tested directly; the
 * React binding is lib/useAccountFollow.ts. Guests are never handled
 * here: a tap by a visitor who isn't signed in is handed back to the
 * component ("guest"), which keeps its own email-capture flow. */

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

export interface FollowToggleDeps {
  /** Resolves the signed-in state (awaited on every tap, so a tap made
   * before the page's own check finished never takes the guest path for
   * a signed-in visitor). */
  isSignedIn: () => Promise<boolean>;
  write: (desired: boolean) => Promise<boolean | null>;
  get: () => boolean;
  set: (following: boolean) => void;
  setPending: (pending: boolean) => void;
}

export type FollowToggleResult =
  | { kind: "guest" }
  | { kind: "busy" }
  | { kind: "done"; ok: boolean; following: boolean };

/** One control's tap handling: one write in flight at a time (extra taps
 * are ignored, never queued), optimistic flip, explicit desired-state
 * write, the server's answer applied, revert on failure. */
export function createFollowToggle(deps: FollowToggleDeps) {
  let inFlight = false;
  let writes = 0;
  return {
    /** Writes started so far — a slower initial state read must not
     * overwrite a state the visitor has already changed. */
    writes: () => writes,
    async toggle(): Promise<FollowToggleResult> {
      if (inFlight) return { kind: "busy" };
      inFlight = true;
      try {
        if (!(await deps.isSignedIn())) return { kind: "guest" };
        const before = deps.get();
        const desired = !before;
        writes += 1;
        deps.setPending(true);
        deps.set(desired);
        let server: boolean | null;
        try {
          server = await deps.write(desired);
        } catch {
          server = null;
        }
        if (server === null) {
          deps.set(before);
          return { kind: "done", ok: false, following: before };
        }
        deps.set(server);
        return { kind: "done", ok: true, following: server };
      } finally {
        inFlight = false;
        deps.setPending(false);
      }
    },
  };
}
