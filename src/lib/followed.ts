// Per-device record of which businesses this browser has already followed
// (submitted an email for) — lets the primary Follow button honestly show
// "Following" without an account system. Mirrors lib/saved.ts's pattern.
// This is separate from the followers table itself (the source of truth
// for the business/founder) — this is purely "has *this device* already
// done it," so the button doesn't ask again.

const KEY = "findmi_followed_business_slugs";

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function write(slugs: string[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(slugs));
  } catch {
    // Storage unavailable — the follow submission itself still succeeded
    // server-side; this device just won't remember it locally.
  }
}

export function isFollowed(slug: string): boolean {
  return read().includes(slug);
}

export function markFollowed(slug: string): void {
  const current = read();
  if (!current.includes(slug)) write([...current, slug]);
}
