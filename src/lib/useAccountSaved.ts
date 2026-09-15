"use client";

import { useEffect, useState } from "react";
import {
  isSaved,
  toggleSaved,
  isEventSaved,
  toggleEventSaved,
  isProductSaved,
  toggleProductSaved,
  isLocationSaved,
  toggleLocationSaved,
} from "@/lib/saved";
import { getAccountSession } from "@/lib/accountSession";
import { trackEvent } from "@/lib/analytics/track";

export type SavedEntityType = "business" | "event" | "product" | "location";

// Analytics attribution pass — maps each saved entity type onto the
// explicit FK column analytics_events carries for it (see the migration).
// Reused by every Save button via this one shared hook, so Save analytics
// only needed one integration point, per the completed audit.
const ENTITY_FK_FIELD: Record<SavedEntityType, "business_id" | "event_id" | "product_id" | "location_id"> = {
  business: "business_id",
  event: "event_id",
  product: "product_id",
  location: "location_id",
};

const LOCAL = {
  business: { isSaved, toggle: toggleSaved },
  event: { isSaved: isEventSaved, toggle: toggleEventSaved },
  product: { isSaved: isProductSaved, toggle: toggleProductSaved },
  location: { isSaved: isLocationSaved, toggle: toggleLocationSaved },
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
export function useAccountSaved(type: SavedEntityType, slug: string, id?: string) {
  const [saved, setSaved] = useState(false);
  const [authed, setAuthed] = useState(false);

  // Analytics attribution pass — fires save/unsave only after the real
  // toggle actually succeeded (see both call sites in toggle() below),
  // never speculatively. `id` is optional so this hook keeps working
  // exactly as before for any caller that hasn't been updated to pass a
  // real database id yet — that caller's Save/Unsave behavior is
  // unaffected either way; it just doesn't emit an analytics event with
  // this hook's shared logic when the id is unknown to it (own call site
  // could still emit separately, e.g. via a wrapping component).
  function emit(nowSaved: boolean) {
    if (!id) return;
    trackEvent({
      event_name: nowSaved ? "save" : "unsave",
      subject_type: type,
      subject_id: id,
      [ENTITY_FK_FIELD[type]]: id,
    });
  }

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
      const nowSaved = LOCAL[type].toggle(slug);
      setSaved(nowSaved);
      emit(nowSaved);
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
        if (data) {
          // Real, server-confirmed result — the only point this hook
          // treats a signed-in Save/Unsave as having actually happened;
          // a failed request (data === null, handled below) never emits.
          setSaved(Boolean(data.saved));
          emit(Boolean(data.saved));
        } else {
          setSaved(!next); // request failed server-side — revert
        }
      })
      .catch(() => setSaved(!next));
  }

  return { saved, toggle };
}
