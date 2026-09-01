"use client";

import { useEffect, useState } from "react";
import { isSaved, toggleSaved, isEventSaved, toggleEventSaved, isProductSaved, toggleProductSaved } from "@/lib/saved";
import { getAccountSession } from "@/lib/accountSession";

export type SavedEntityType = "business" | "event" | "product";

const LOCAL = {
  business: { isSaved, toggle: toggleSaved },
  event: { isSaved: isEventSaved, toggle: toggleEventSaved },
  product: { isSaved: isProductSaved, toggle: toggleProductSaved },
} as const;

/** One save/bookmark control's state + toggle, for any of the three
 * saveable entity types — shared by SaveButton/EventSaveButton/
 * ProductSaveButton so the guest-vs-authenticated branching only exists
 * once. Guest behavior is byte-for-byte what it was before this pass:
 * lib/saved.ts's per-device localStorage lists, zero network. Once the
 * page-shared session check (see accountSession.ts) resolves true, this
 * control's real account-backed status is fetched and takes over, and
 * toggling calls /api/account/save instead of touching localStorage —
 * the account, not the device, becomes authoritative for a signed-in
 * visitor, without ever requiring sign-in just to save something. */
export function useAccountSaved(type: SavedEntityType, slug: string) {
  const [saved, setSaved] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    const local = LOCAL[type];
    setSaved(local.isSaved(slug));

    let cancelled = false;
    getAccountSession().then((isAuthed) => {
      if (cancelled || !isAuthed) return;
      setAuthed(true);
      fetch(`/api/account/save?type=${type}&slug=${encodeURIComponent(slug)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { saved?: boolean } | null) => {
          if (!cancelled && data) setSaved(Boolean(data.saved));
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [type, slug]);

  function toggle() {
    if (!authed) {
      setSaved(LOCAL[type].toggle(slug));
      return;
    }
    const next = !saved;
    setSaved(next); // optimistic
    fetch("/api/account/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, slug }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { saved?: boolean } | null) => {
        if (data) setSaved(Boolean(data.saved));
        else setSaved(!next); // request failed server-side — revert
      })
      .catch(() => setSaved(!next));
  }

  return { saved, toggle };
}
