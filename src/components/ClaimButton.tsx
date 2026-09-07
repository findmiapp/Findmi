"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getAccountSession } from "@/lib/accountSession";

type ClaimState =
  | "loading"
  | "guest"
  | "none"
  | "pending_review" // both types — free, no payment step
  | "membership_required" // event claims only — no qualifying FindMi access yet
  | "member";

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
 * — submitting goes straight to "under review", no payment step.
 * Multi-Entity Self-Service V1 makes EVENT claims free too, with no
 * separate Event fee ever: submit -> straight to "under review" IF the
 * claimant already has qualifying FindMi access (active Pro, or a
 * redeemed Pro Invite, on some business they belong to); otherwise the
 * API returns "membership_required" and no claim row is even created —
 * see /api/account/claim's own resolvePendingState. Stage 3 adds LOCATION
 * claims, free for every signed-in user exactly like business (never
 * entitlement-gated).
 *
 * Submitting the claim form never grants access on its own — only founder
 * approval (business_members/event_members/location_members) does, and
 * identity is always the session's user_id, never the submitted contact
 * email. This component only ever reads/writes claim state via
 * /api/account/claim; it has no way to mark anything approved itself. */
export default function ClaimButton({
  type,
  slug,
  entityName,
  variant = "inline",
}: {
  type: "business" | "event" | "location";
  slug: string;
  entityName: string;
  /** "inline" (default, unchanged) — the original small muted text link,
   * used as-is wherever this component was already placed (e.g. the event
   * page). "card" — same flow/modal/state logic, wrapped in a small
   * "Is this your business?" card for the entry-point states (guest/none).
   * The other states (pending_review/membership_required) already render
   * their own self-contained card and are unaffected by this prop. */
  variant?: "inline" | "card";
}) {
  const [state, setState] = useState<ClaimState>("loading");
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
            if (data?.fullName == null && data?.email == null && data?.phone == null && data?.accountEmail) {
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

  const noun = type === "business" ? "business" : type === "location" ? "venue" : "event";

  if (state === "loading" || state === "member") return null;

  if (state === "guest") {
    // window is safe here — this branch only ever renders after the
    // mount effect above resolves "guest" client-side; the initial
    // server-rendered pass is always "loading" (renders null).
    const next = `${window.location.pathname}?claim=1`;
    const signInHref = `/login?next=${encodeURIComponent(next)}`;

    // Claim auth gate (business/location only — event claims below are
    // unchanged): no claim form fields for a logged-out visitor, just
    // this message and the existing /login entry point. next= preserves
    // this exact business/venue URL, and ?claim=1 is what already reopens
    // the claim flow automatically once they're back and signed in (see
    // the mount effect above).
    if (type === "business" || type === "location") {
      const prompt = (
        <div className={variant === "card" ? "rounded-2xl border border-black/10 bg-white p-5 sm:p-6" : ""}>
          <p className="text-sm text-ink/60">Create your free Findmi account to claim and manage this {noun}.</p>
          <a
            href={signInHref}
            className="mt-3 flex h-10 items-center justify-center rounded-full bg-findmi px-4 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          >
            Sign In
          </a>
        </div>
      );
      return prompt;
    }

    const link = (
      <a href={signInHref} className="text-xs font-semibold text-ink/40 hover:text-ink/70">
        Claim this {noun}
      </a>
    );
    return variant === "card" ? <ClaimCard noun={noun}>{link}</ClaimCard> : link;
  }

  if (state === "pending_review") {
    return (
      <div className="max-w-sm rounded-2xl border border-black/10 bg-white p-4">
        <p className="text-sm font-semibold text-ink">Claim submitted. Your claim is under review.</p>
        <p className="mt-1 text-xs text-ink/50">
          Findmi will manually verify your connection to this {noun} before granting management access.
        </p>
        <p className="mt-1 text-xs text-ink/50">Standard claims are typically reviewed within 48–72 hours.</p>

        {/* Post-claim Pro offer — priority review only, never a guarantee
            of approval (see below). Not a payment integration: a plain
            link out to the existing Tally Pro-upgrade form. Business and
            location claims only: an event claimant already has qualifying
            FindMi Pro/Invite access by the time they can reach this state
            (see /api/account/claim's entitlement gate), so offering them
            "Upgrade to Pro" here would be redundant/confusing. */}
        {type !== "event" && (
          <div className="mt-3 rounded-xl border border-findmi/20 bg-findmi-50 p-3">
            <p className="text-xs font-bold text-ink">Need access sooner?</p>
            <p className="mt-1 text-xs text-ink/60">
              Upgrade to Findmi Pro for priority review, typically within 2 business hours during regular business
              hours, plus your full business profile, gallery, products, appearances, contact links and more.
            </p>
            {/* Pro Upgrade — Internal Checkout Handoff Foundation pass: this
                claimant doesn't own the business yet (claim still pending
                founder approval), so this stays a plain link to /join
                rather than the owner-only /upgrade/pro handoff — a payment
                must never imply or expedite claim approval. */}
            <a
              href="/join"
              className="mt-2 flex h-9 items-center justify-center rounded-full bg-findmi px-3 text-[11px] font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
            >
              Upgrade to Pro
            </a>
          </div>
        )}
      </div>
    );
  }

  if (state === "membership_required") {
    // Multi-Entity Self-Service V1 — replaces the old $20 Tally payment
    // step. Event management is included with qualifying FindMi
    // membership (active Pro, or a redeemed Pro Invite, on some business
    // the visitor belongs to) — never a separate Event fee, so this links
    // to the existing Pro/Invite path (/join) rather than any checkout.
    return (
      <div className="max-w-xs rounded-2xl border border-black/10 bg-white p-4">
        <p className="text-sm font-semibold text-ink">Event management is included with qualifying Findmi membership.</p>
        <p className="mt-1 text-xs text-ink/60">
          Get Findmi Pro (or redeem a Pro Invite) on a business you manage to claim and manage this event — no
          separate Event fee.
        </p>
        <a
          href="/join"
          className="mt-3 flex h-10 items-center justify-center rounded-full bg-findmi px-4 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Get Findmi Pro
        </a>
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
      {variant === "card" ? <ClaimCard noun={noun}>{trigger}</ClaimCard> : trigger}

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
                {type === "event" ? (
                  <>
                    Claiming requests management access to this {noun}. Event management is included with your
                    qualifying Findmi membership — no separate Event fee. Findmi reviews every request manually;
                    submitting a claim doesn&rsquo;t guarantee access.
                  </>
                ) : (
                  <>
                    Claiming requests management access to this {noun}. Findmi reviews every request manually —
                    submitting a claim doesn&rsquo;t guarantee access.
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
                  {submitting ? "…" : "Submit for Review"}
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
 * this component's own trigger element. `noun` defaults to "business" —
 * every existing caller predates the location/event nouns and keeps
 * reading exactly as before. */
function ClaimCard({ children, noun = "business" }: { children: React.ReactNode; noun?: string }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
      <h2 className="font-display text-base font-bold tracking-tight text-ink">Is this your {noun}?</h2>
      <p className="mt-1.5 text-sm text-ink/60">Claim your free Findmi listing to manage your {noun} information.</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}
