// One shared, memoized "is this device's visitor signed in?" check per
// page load — every Save/Follow control on a page (there can be many, in
// a grid) uses this instead of each independently hitting
// /api/account/me. Guests: resolves to false after one small background
// request; nothing about their existing localStorage-only save/follow
// behavior changes or is gated on this resolving.
let cached: Promise<boolean> | null = null;

export function getAccountSession(): Promise<boolean> {
  if (!cached) {
    cached = fetch("/api/account/me")
      .then((res) => (res.ok ? res.json() : { authenticated: false }))
      .then((data: { authenticated?: boolean }) => Boolean(data?.authenticated))
      .catch(() => false);
  }
  return cached;
}
