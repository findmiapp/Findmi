// Per-device record of which events this browser has already followed
// (submitted an email for) — exact event-side mirror of lib/followed.ts's
// business version. Separate localStorage key, same shape/reasoning.

const KEY = "findmi_followed_event_ids";

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

export function isEventFollowed(eventId: string): boolean {
  return read().includes(eventId);
}

export function markEventFollowed(eventId: string): void {
  const current = read();
  if (!current.includes(eventId)) write([...current, eventId]);
}
