// Per-device record of which locations this browser has already followed
// (submitted an email for) — exact location-side mirror of
// lib/followedEvents.ts's event version.

const KEY = "findmi_followed_location_ids";

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function write(ids: string[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Storage unavailable — the follow submission itself still succeeded
    // server-side; this device just won't remember it locally.
  }
}

export function isLocationFollowed(locationId: string): boolean {
  return read().includes(locationId);
}

export function markLocationFollowed(locationId: string): void {
  const current = read();
  if (!current.includes(locationId)) write([...current, locationId]);
}

// Universal Account V1 foundation — same addition as
// lib/followedEvents.ts's getFollowedEventIds(): the full per-device list
// for the account sync import. Stores real location ids, not slugs.
export function getFollowedLocationIds(): string[] {
  return read();
}
