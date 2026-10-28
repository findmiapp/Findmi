"use client";

import { getSavedSlugs, getSavedEventSlugs, getSavedProductSlugs, getSavedLocationSlugs } from "@/lib/saved";
import { getFollowedSlugs } from "@/lib/followed";
import { getFollowedEventIds } from "@/lib/followedEvents";
import { getFollowedLocationIds } from "@/lib/followedLocations";

const SYNCED_KEY = "findmi_account_synced_v1";

/** Runs at most once per device (tracked via a local flag — not required
 * for correctness, since /api/account/sync is itself idempotent, just
 * avoids re-POSTing on every /account visit) to carry this device's
 * existing localStorage saved/followed lists (lib/saved.ts, lib/followed.ts,
 * lib/followedEvents.ts, lib/followedLocations.ts) into the signed-in
 * user's new account-backed tables. Local data is left in place either
 * way — nothing here clears localStorage, so nothing is lost if the
 * request fails or the account tables are ever rolled back. Missing/stale
 * entries are resolved and silently skipped server-side (see that route).
 *
 * Universal Account V1 foundation — now covers all seven relationship
 * lists (previously four: saved businesses/events/products, followed
 * businesses). Adds saved locations plus followed events/locations, so a
 * device's full existing local history carries over on sign-in, not just
 * the original three entity types. */
/** Fingerprint of the device's local lists. The flag now stores this
 * (instead of a bare "1"), so Saves made on this device AFTER a first
 * import — e.g. while signed out again — are carried over on the next
 * signed-in visit too. The import itself is idempotent server-side, so a
 * re-run can never duplicate anything; nothing local is ever cleared. */
export function localListsFingerprint(lists: Record<string, readonly string[]>): string {
  return Object.keys(lists)
    .sort()
    .map((k) => `${k}:${[...lists[k]].sort().join(",")}`)
    .join("|");
}

export function syncLocalToAccountOnce(): void {
  if (typeof window === "undefined") return;

  const businessSlugs = getSavedSlugs();
  const eventSlugs = getSavedEventSlugs();
  const productSlugs = getSavedProductSlugs();
  const locationSlugs = getSavedLocationSlugs();
  const followedBusinessSlugs = getFollowedSlugs();
  const followedEventIds = getFollowedEventIds();
  const followedLocationIds = getFollowedLocationIds();

  const fingerprint = localListsFingerprint({ businessSlugs, eventSlugs, productSlugs, locationSlugs, followedBusinessSlugs, followedEventIds, followedLocationIds });
  const previous = window.localStorage.getItem(SYNCED_KEY);
  // A device flagged by the earlier once-only version ("1") re-imports
  // once — safe, the import is idempotent — then tracks the fingerprint.
  if (previous === fingerprint) return;

  if (
    businessSlugs.length === 0 &&
    eventSlugs.length === 0 &&
    productSlugs.length === 0 &&
    locationSlugs.length === 0 &&
    followedBusinessSlugs.length === 0 &&
    followedEventIds.length === 0 &&
    followedLocationIds.length === 0
  ) {
    window.localStorage.setItem(SYNCED_KEY, fingerprint);
    return;
  }

  fetch("/api/account/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      businessSlugs,
      eventSlugs,
      productSlugs,
      locationSlugs,
      followedBusinessSlugs,
      followedEventIds,
      followedLocationIds,
    }),
  })
    .then((res) => {
      if (res.ok) window.localStorage.setItem(SYNCED_KEY, fingerprint);
    })
    .catch(() => {
      // Network hiccup — leave the flag unset so this retries on the next
      // /account visit instead of silently losing the import forever.
    });
}
