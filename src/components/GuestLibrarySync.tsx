"use client";

import { useEffect, useState } from "react";
import { clearGuestLibrary, isGuestLibraryEmpty, readGuestLibrary, toImportPayload } from "@/lib/guest-library";

const LOCK = "findmi_guest_library_sync_lock";

/** Signed in with guest saves still on this device (made before signing
 * in / up): merge them into the account (/api/collections/import —
 * idempotent; duplicates and conflicts resolved there) and clear the device
 * copy ONLY after the server confirms and nothing changed meanwhile. A
 * failure leaves everything in place; the next page load tries again.
 * Renders a short confirmation, otherwise nothing. */
export default function GuestLibrarySync({ authenticated }: { authenticated: boolean }) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!authenticated) return;
    const { lib, persistent } = readGuestLibrary();
    if (!persistent || isGuestLibraryEmpty(lib)) return;
    // One sync at a time across tabs (the server is idempotent anyway).
    try {
      const held = Number(window.sessionStorage.getItem(LOCK) ?? 0);
      if (Date.now() - held < 30_000) return;
      window.sessionStorage.setItem(LOCK, String(Date.now()));
    } catch {
      /* no session storage — proceed; the import is idempotent */
    }
    let alive = true;
    fetch("/api/collections/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toImportPayload(lib)) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { ok?: boolean } | null) => {
        if (!d?.ok) return;
        // Clear only the exact copy that was merged.
        const now = readGuestLibrary().lib;
        if (now.updatedAt !== lib.updatedAt) return;
        clearGuestLibrary();
        if (alive) setDone(true);
      })
      .catch(() => undefined)
      .finally(() => {
        try {
          window.sessionStorage.removeItem(LOCK);
        } catch {
          /* ignore */
        }
      });
    return () => {
      alive = false;
    };
  }, [authenticated]);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 5000);
    return () => clearTimeout(t);
  }, [done]);

  if (!done) return null;
  return (
    <div role="status" className="fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[60] mx-auto max-w-sm rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white shadow-lg sm:inset-x-auto sm:right-6">
      Your collections are now saved to your account.
    </div>
  );
}
