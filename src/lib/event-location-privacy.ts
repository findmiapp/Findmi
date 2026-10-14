// Event location privacy — read-time enforcement (server; shared by every
// public data read that can expose a place).
//
// The AUTHORITATIVE signal is the parent Event's events.location_visibility.
// When it is 'hidden' (the organizer shares the address only after
// registration), no public surface may expose — for that Event, its dates,
// or any Appearance linked to it — a precise venue name, street address,
// postal code, coordinates, Findmi Location link or directions. City/state
// stay public. Stored rows are never mutated here (a Location, an
// occurrence's location_id or an Appearance's venue text all stay as they
// are); only what is returned for display is withheld. Unrelated Events and
// Appearances at the same Location are unaffected.
//
// Migration tolerance: the lookup is a separate, narrow query. Before the
// location_visibility migration is applied the column doesn't exist, the
// query errors, and the answer is "nothing is hidden" — which is exactly
// true then (no Event can be hidden without the column). No other read
// selects the column by name, so nothing else can fail on it.
import type { SupabaseClient } from "@supabase/supabase-js";

type Client = Pick<SupabaseClient, "from">;

/** Ids (of `eventIds`) whose Event withholds its location. Never throws. */
export async function fetchHiddenEventIds(client: Client | null, eventIds: (string | null | undefined)[]): Promise<Set<string>> {
  const ids = [...new Set(eventIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
  if (!client || ids.length === 0) return new Set();
  try {
    const { data, error } = await client.from("events").select("id").in("id", ids).eq("location_visibility", "hidden");
    if (error || !data) return new Set();
    return new Set((data as { id: string }[]).map((r) => r.id));
  } catch {
    return new Set();
  }
}

/** Precise-place fields a public row may carry (any that are present are
 * withheld; city/state are kept). */
const PRECISE_KEYS = ["venue_name", "address", "postal_code", "latitude", "longitude", "location_id", "location", "locations"] as const;

/** The row as it may be shown publicly when its Event hides the location:
 * precise place fields → null, plus `location_hidden: true` so a surface
 * can say "Location shared after registration". Shape is preserved. */
export function withholdPreciseLocation<T extends object>(row: T): T & { location_hidden: true } {
  const out: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  for (const key of PRECISE_KEYS) if (key in out) out[key] = null;
  out.location_hidden = true;
  return out as T & { location_hidden: true };
}

/** Applies parent-Event privacy to a list of rows (Appearances or
 * occurrences): rows whose Event is hidden are withheld; others unchanged. */
export async function applyEventLocationPrivacy<T extends object>(
  client: Client | null,
  rows: T[],
  eventIdOf: (row: T) => string | null | undefined
): Promise<T[]> {
  const hidden = await fetchHiddenEventIds(client, rows.map(eventIdOf));
  if (hidden.size === 0) return rows;
  return rows.map((r) => {
    const id = eventIdOf(r);
    return id && hidden.has(id) ? withholdPreciseLocation(r) : r;
  });
}

/** Drops rows whose Event hides its location — for place-scoped feeds (a
 * Location's own "What's Happening Here", Location activity counts) where
 * merely listing the item would reveal that it happens at that place. */
export async function excludeHiddenEventRows<T>(client: Client | null, rows: T[], eventIdOf: (row: T) => string | null | undefined): Promise<T[]> {
  const hidden = await fetchHiddenEventIds(client, rows.map(eventIdOf));
  if (hidden.size === 0) return rows;
  return rows.filter((r) => {
    const id = eventIdOf(r);
    return !(id && hidden.has(id));
  });
}
