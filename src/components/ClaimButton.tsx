"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getAccountSession } from "@/lib/accountSession";

type ClaimState = "loading" | "guest" | "none" | "pending" | "member";

/** Secondary "Claim this business/event" control — deliberately understated
 * (muted text link, not a button competing with Follow/Save/Inquire), per
 * this pass's explicit UX requirement. Guests are routed through the
 * existing /login flow with a safe next= redirect (?claim=1 appended, so
 * this component reopens the claim form automatically on return — see the
 * effect below); signed-in visitors get the real submit flow. Submitting
 * never grants access itself — only founder approval (business_members/
 * event_members) does; this only ever creates a pending claim_requests
 * row via /api/account/claim. */
export default function ClaimButton({
  type,
  slug,
  entityName,
}: {
  type: "business" | "event";
  slug: string;
  entityName: string;
}) {
  const [state, setState] = useState<ClaimState>("loading");
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let cancelled = false;
    getAccountSession().then((authed) => {
      if (cancelled) return;
      if (!authed) {
        setState("guest");
        return;
      }
      fetch(`/api/account/claim?type=${type}&slug=${encodeURIComponent(slug)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { state?: ClaimState } | null) => {
          if (cancelled) return;
          const resolved = data?.state ?? "none";
          setState(resolved);
          // Resume the flow automatically after a signed-out visitor was
          // routed through /login?next=<this page>?claim=1 and comes back
          // signed in — see the "guest" render branch below for where
          // ?claim=1 is added.
          if (resolved === "none" && new URLSearchParams(window.location.search).get("claim") === "1") {
            setOpen(true);
          }
        })
        .catch(() => {
          if (!cancelled) setState("none");
        });
    });
    return () => {
      cancelled = true;
    };
  }, [type, slug]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/account/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, slug, message: message.trim() || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.state) {
        setState(data.state);
        setOpen(false);
      } else {
        setError(data?.error || "Couldn't submit your claim. Please try again.");
      }
    } catch {
      setError("Couldn't submit your claim. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const noun = type === "business" ? "business" : "event";

  if (state === "loading" || state === "member") return null;

  if (state === "guest") {
    // window is safe here — this branch only ever renders after the
    // mount effect above resolves "guest" client-side; the initial
    // server-rendered pass is always "loading" (renders null).
    const next = `${window.location.pathname}?claim=1`;
    return (
      <a href={`/login?next=${encodeURIComponent(next)}`} className="text-xs font-semibold text-ink/40 hover:text-ink/70">
        Claim this {noun}
      </a>
    );
  }

  if (state === "pending") {
    return <p className="text-xs font-semibold text-ink/40">Claim submitted for review.</p>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-ink/40 hover:text-ink/70"
      >
        Claim this {noun}
      </button>

      {mounted &&
        open &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
            <div onClick={() => setOpen(false)} className="fixed inset-0 bg-black/40" />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`Claim ${entityName}`}
              className="relative w-full rounded-t-3xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-xl sm:max-w-sm sm:rounded-3xl sm:pb-5"
            >
              <h2 className="font-display text-lg font-bold tracking-tight text-ink">Claim {entityName}</h2>
              <p className="mt-1.5 text-sm text-ink/60">
                Claiming requests management access to this {noun}. FindMi reviews every request — submitting doesn&rsquo;t
                grant access right away.
              </p>

              <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={`How are you connected to this ${noun}? (optional)`}
                  rows={3}
                  className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
                />
                {error && <p className="text-xs text-red-600">{error}</p>}
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex h-12 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-60"
                >
                  {submitting ? "…" : "Submit Claim"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-center text-xs font-semibold text-ink/50 transition hover:text-ink"
                >
                  Cancel
                </button>
              </form>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
