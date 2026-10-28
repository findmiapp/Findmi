"use client";

import { useEffect, useState } from "react";
import { getAccountSession } from "@/lib/accountSession";
import { trackEvent } from "@/lib/analytics/track";
import type { WantSource } from "@/lib/product-wants-domain";

// One Want control's state, for any number of controls on a page (a grid
// of Product cards): signed-in status is fetched in ONE batched request per
// tick (/api/product-want?ids=…) and shared; every control for the same
// Product stays in sync. Signed out, "wanted" is this device remembering
// the visitor already left their email for it (the server keeps the real
// demand signal; it is never readable back without an account).

const GUEST_KEY = "findmi_wanted_products";

function readGuest(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(GUEST_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function rememberGuest(productId: string) {
  try {
    const list = readGuest();
    if (!list.includes(productId)) window.localStorage.setItem(GUEST_KEY, JSON.stringify([...list, productId]));
  } catch {
    // storage unavailable — the server still has the Want
  }
}

const state = new Map<string, boolean>();
const listeners = new Map<string, Set<(v: boolean) => void>>();
let pending = new Set<string>();
let scheduled = false;

function notify(id: string, value: boolean) {
  state.set(id, value);
  for (const fn of listeners.get(id) ?? []) fn(value);
}

function flush() {
  scheduled = false;
  const ids = [...pending];
  pending = new Set();
  for (let i = 0; i < ids.length; i += 60) {
    const chunk = ids.slice(i, i + 60);
    fetch(`/api/product-want?ids=${chunk.join(",")}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { wanted?: string[] } | null) => {
        const wanted = new Set(d?.wanted ?? []);
        for (const id of chunk) notify(id, wanted.has(id));
      })
      .catch(() => {});
  }
}

function requestStatus(id: string) {
  if (state.has(id)) return;
  pending.add(id);
  if (!scheduled) {
    scheduled = true;
    setTimeout(flush, 0);
  }
}

export interface ProductWantControl {
  wanted: boolean;
  signedIn: boolean | null;
  busy: boolean;
  error: string | null;
  /** Signed in: toggles. Signed out: the caller opens the email sheet. */
  toggle: () => void;
  /** Signed-out email interest. Resolves true on success. */
  submitEmail: (email: string, honeypot?: string) => Promise<boolean>;
}

export function useProductWant(productId: string, source: WantSource, sourceChannel?: string): ProductWantControl {
  const [wanted, setWanted] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const set = (v: boolean) => !cancelled && setWanted(v);
    const subs = listeners.get(productId) ?? new Set();
    subs.add(set);
    listeners.set(productId, subs);
    getAccountSession().then((authed) => {
      if (cancelled) return;
      setSignedIn(authed);
      if (authed) {
        if (state.has(productId)) setWanted(state.get(productId)!);
        else requestStatus(productId);
      } else {
        setWanted(readGuest().includes(productId));
      }
    });
    return () => {
      cancelled = true;
      subs.delete(set);
    };
  }, [productId]);

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/product-want", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, source, sourceChannel, ...body }),
    });
    const data = (await res.json().catch(() => null)) as { wanted?: boolean; error?: string } | null;
    return { ok: res.ok && Boolean(data), data };
  }

  function toggle() {
    if (!signedIn || busy) return;
    const next = !wanted;
    notify(productId, next); // optimistic, every control for this Product
    setBusy(true);
    setError(null);
    post({ on: next })
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data?.error ?? "");
        notify(productId, Boolean(data!.wanted));
        trackEvent({ event_name: data!.wanted ? "want" : "unwant", subject_type: "product", subject_id: productId, product_id: productId, metadata: { source } });
      })
      .catch(() => {
        notify(productId, !next);
        setError("Couldn't update that. Please try again.");
      })
      .finally(() => setBusy(false));
  }

  async function submitEmail(email: string, honeypot = "") {
    setBusy(true);
    setError(null);
    try {
      const { ok, data } = await post({ on: true, email, website: honeypot });
      if (!ok) {
        setError(data?.error ?? "Couldn't save that. Please try again.");
        return false;
      }
      rememberGuest(productId);
      notify(productId, true);
      trackEvent({ event_name: "want", subject_type: "product", subject_id: productId, product_id: productId, metadata: { source, signed_out: true } });
      return true;
    } catch {
      setError("Couldn't save that. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { wanted, signedIn, busy, error, toggle, submitEmail };
}
