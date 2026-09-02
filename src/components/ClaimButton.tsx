"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getAccountSession } from "@/lib/accountSession";
import { getClaimPaymentFormUrl } from "@/lib/tally";

type ClaimState =
  | "loading"
  | "guest"
  | "none"
  | "pending_review" // business claims only — free, no payment step
  | "awaiting_payment" // event claims only
  | "paid_pending_review" // event claims only
  | "member";

type ContactInfo = { fullName: string; email: string; phone: string };

/** Secondary "Claim this business/event" control — deliberately understated
 * (muted text link, not a button competing with Follow/Save/Inquire).
 * Guests are routed through the existing /login flow with a safe next=
 * redirect (?claim=1 appended, so this component reopens the claim form
 * automatically on return); signed-in visitors get the real flow:
 *
 *   submit claim (full name/email/phone required — email prefilled from
 *   the account but editable; message optional) -> "under review" ->
 *   founder approves/rejects.
 *
 * BUSINESS claims are free (see CLAIMS: REMOVE PAYMENT REQUIREMENT ONLY)
 * — submitting goes straight to "under review", no payment step. EVENT
 * claims are unchanged and still require payment before review: submit
 * (unpaid, pending) -> pay $20 via Tally (full_name/email/phone passed
 * through as hidden fields so Tally never has to ask again) -> webhook
 * marks payment_status='paid' -> "under review" -> founder approves/
 * rejects.
 *
 * Submitting the claim form never grants access on its own — neither does
 * paying, for an event claim — only founder approval (business_members/
 * event_members) does, and identity is always the session's user_id,
 * never the submitted contact email. This component only ever reads/
 * writes claim state via /api/account/claim; it has no way to mark
 * anything paid or approved itself. */
export default function ClaimButton({
  type,
  slug,
  entityName,
  variant = "inline",
}: {
  type: "business" | "event";
  slug: string;
  entityName: string;
  /** "inline" (default, unchanged) — the original small muted text link,
   * used as-is wherever this component was already placed (e.g. the event
   * page). "card" — same flow/modal/state logic, wrapped in a small
   * "Is this your business?" card for the entry-point states (guest/none).
   * The other states (pending_review/awaiting_payment/paid_pending_review)
   * already render their own self-contained card and are unaffected by
   * this prop. */
  variant?: "inline" | "card";
}) {
  const [state, setState] = useState<ClaimState>("loading");
  const [claimId, setClaimId] = useState<string | null>(null);
  const [contact, setContact] = useState<ContactInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [fullNameInput, setFullNameInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let cancelled = false;
    getAccountSession().then((authed) => {
      if (cancelled) return;
      // Always check claim status via the API, signed in or not — an
      // already-claimed (or already-pending-from-someone-else) business
      // must never offer the CTA, guests included, so a guest can no
      // longer skip straight to the "guest" login-link render below
      // without first confirming the business is actually still open to
      // claim (see the API route's own admin-scoped eligibility check).
      fetch(`/api/account/claim?type=${type}&slug=${encodeURIComponent(slug)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then(
          (
            data: {
              state?: ClaimState;
              claimId?: string;
              fullName?: string;
              email?: string;
              phone?: string;
              accountEmail?: string | null;
            } | null
          ) => {
            if (cancelled) return;
            const resolved = data?.state ?? "none";
            // "none" from the API means the business is genuinely still
            // open to claim — for a signed-out visitor that's the existing
            // login-routed CTA; any other resolved state (member/pending/
            // etc.) already means "don't show a claim CTA" and applies
            // the same regardless of auth.
            setState(!authed && resolved === "none" ? "guest" : resolved);
            setClaimId(data?.claimId ?? null);
            if (data?.fullName != null || data?.email != null || data?.phone != null) {
              setContact({ fullName: data.fullName ?? "", email: data.email ?? "", phone: data.phone ?? "" });
            } else if (data?.accountEmail) {
              // No claim exists yet — prefill the form's Email field from
              // the account, but this is only a starting point: the
              // claimant can edit it, and nothing is stored until they
              // submit.
              setEmailInput(data.accountEmail);
            }
            // Resume the flow automatically after a signed-out visitor was
            // routed through /login?next=<this page>?claim=1 and comes back
            // signed in — see the "guest" render branch below for where
            // ?claim=1 is added.
            if (resolved === "none" && new URLSearchParams(window.location.search).get("claim") === "1") {
              setOpen(true);
            }
          }
        )
        .catch(() => {
          if (!cancelled) setState(authed ? "none" : "guest");
        });
    });
    return () => {
      cancelled = true;
    };
  }, [type, slug]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const fullName = fullNameInput.trim();
    const email = emailInput.trim();
    const phone = phoneInput.trim();
    if (!fullName || !email || !phone) {
      setError("Full name, email, and phone are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/account/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, slug, fullName, email, phone, message: message.trim() || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.state) {
        setState(data.state);
        setClaimId(data.claimId ?? null);
        setContact({ fullName: data.fullName ?? fullName, email: data.email ?? email, phone: data.phone ?? phone });
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
    const link = (
      <a href={`/login?next=${encodeURIComponent(next)}`} className="text-xs font-semibold text-ink/40 hover:text-ink/70">
        Claim this {noun}
      </a>
    );
    return variant === "card" ? <ClaimCard>{link}</ClaimCard> : link;
  }

  if (state === "pending_review") {
    return (
      <div className="max-w-sm rounded-2xl border border-black/10 bg-white p-4">
        <p className="text-sm font-semibold text-ink">Claim submitted. Your claim is under review.</p>
        <p className="mt-1 text-xs text-ink/50">
          FindMi will manually verify your connection to this {noun} before granting management access.
        </p>
        <p className="mt-1 text-xs text-ink/50">Standard claims are typically reviewed within 48–72 hours.</p>

        {/* Post-claim Pro offer — priority review only, never a guarantee
            of approval (see below). Not a payment integration: a plain
            link out to the existing Tally Pro-upgrade form. */}
        <div className="mt-3 rounded-xl border border-findmi/20 bg-findmi-50 p-3">
          <p className="text-xs font-bold text-ink">Need access sooner?</p>
          <p className="mt-1 text-xs text-ink/60">
            Upgrade to FindMi Pro for priority review, typically within 2 business hours during regular business
            hours, plus your full business profile, gallery, products, appearances, contact links and more.
          </p>
          <a
            href="https://tally.so/r/0QR7LN"
            target="_blank"
            rel="noreferrer"
            className="mt-2 flex h-9 items-center justify-center rounded-full bg-findmi px-3 text-[11px] font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          >
            Upgrade to Pro
          </a>
        </div>
      </div>
    );
  }

  if (state === "awaiting_payment") {
    const payUrl = claimId && contact ? getClaimPaymentFormUrl({ id: claimId, type, ...contact }) : "";
    return (
      <div className="max-w-xs rounded-2xl border border-black/10 bg-white p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Almost done</p>
        <p className="mt-1 text-sm text-ink/70">
          Your claim has been saved. Complete the $20 listing activation payment to submit it for review.
        </p>
        {payUrl ? (
          <a
            href={payUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 flex h-11 items-center justify-center rounded-full bg-findmi px-4 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          >
            Pay $20 &amp; Submit for Review
          </a>
        ) : (
          <p className="mt-3 text-xs text-red-600">Payment isn&rsquo;t configured yet — check back soon.</p>
        )}
      </div>
    );
  }

  if (state === "paid_pending_review") {
    return (
      <div className="max-w-xs rounded-2xl border border-black/10 bg-white p-4">
        <p className="text-sm font-semibold text-ink">Payment received. Your claim is under review.</p>
        <p className="mt-1 text-xs text-ink/50">
          FindMi will manually verify your connection to this {noun} before granting management access — payment
          doesn&rsquo;t guarantee approval.
        </p>
      </div>
    );
  }

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="text-xs font-semibold text-ink/40 hover:text-ink/70"
    >
      Claim this {noun}
    </button>
  );

  return (
    <>
      {variant === "card" ? <ClaimCard>{trigger}</ClaimCard> : trigger}

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
                {type === "business" ? (
                  <>
                    Claiming requests management access to this business. FindMi reviews every request manually —
                    submitting a claim doesn&rsquo;t guarantee access.
                  </>
                ) : (
                  <>
                    Claiming requests management access to this {noun}. A $20 listing activation payment is required
                    to submit your claim for review — FindMi reviews every request manually, and paying
                    doesn&rsquo;t guarantee access.
                  </>
                )}
              </p>

              <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-ink">Full name</span>
                  <input
                    type="text"
                    required
                    value={fullNameInput}
                    onChange={(e) => setFullNameInput(e.target.value)}
                    className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-ink">Email</span>
                  <input
                    type="email"
                    required
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-ink">Phone</span>
                  <input
                    type="tel"
                    required
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-ink">
                    How are you connected to this {noun}? <span className="font-normal text-ink/40">(optional)</span>
                  </span>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={3}
                    className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
                  />
                </label>
                {error && <p className="text-xs text-red-600">{error}</p>}
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex h-12 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-60"
                >
                  {submitting ? "…" : type === "business" ? "Submit for Review" : "Continue to Payment"}
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

/** variant="card" chrome for the entry-point (guest/none) states — same
 * copy/positioning the public business profile places right before
 * "Discover More Like This". Kept local to this file since it only wraps
 * this component's own trigger element. */
function ClaimCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
      <h2 className="font-display text-base font-bold tracking-tight text-ink">Is this your business?</h2>
      <p className="mt-1.5 text-sm text-ink/60">Claim your free FindMi listing to manage your business information.</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}
