"use client";

import { getSavedSlugs, getSavedEventSlugs, getSavedProductSlugs } from "@/lib/saved";
import { getFollowedSlugs } from "@/lib/followed";

const SYNCED_KEY = "findmi_account_synced_v1";

/** Runs at most once per device (tracked via a local flag — not required
 * for correctness, since /api/account/sync is itself idempotent, just
 * avoids re-POSTing on every /account visit) to carry this device's
 * existing localStorage saved/followed slugs (lib/saved.ts,
 * lib/followed.ts) into the signed-in user's new account-backed tables.
 * Local data is left in place either way — nothing here clears
 * localStorage, so nothing is lost if the request fails or the account
 * tables are ever rolled back. Missing/stale slugs are resolved and
 * silently skipped server-side (see that route). */
export function syncLocalToAccountOnce(): void {
  if (typeof window === "undefined") return;
  if (window.localStorage.getItem(SYNCED_KEY)) return;

  const businessSlugs = getSavedSlugs();
  const eventSlugs = getSavedEventSlugs();
  const productSlugs = getSavedProductSlugs();
  const followedBusinessSlugs = getFollowedSlugs();

  if (
    businessSlugs.length === 0 &&
    eventSlugs.length === 0 &&
    productSlugs.length === 0 &&
    followedBusinessSlugs.length === 0
  ) {
    window.localStorage.setItem(SYNCED_KEY, "1");
    return;
  }

  fetch("/api/account/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ businessSlugs, eventSlugs, productSlugs, followedBusinessSlugs }),
  })
    .then((res) => {
      if (res.ok) window.localStorage.setItem(SYNCED_KEY, "1");
    })
    .catch(() => {
      // Network hiccup — leave the flag unset so this retries on the next
      // /account visit instead of silently losing the import forever.
    });
}
