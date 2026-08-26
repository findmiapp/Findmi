"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isFollowed, markFollowed } from "@/lib/followed";

// The single Follow action for a business profile — Follow / Following.
// No accounts exist yet, so "following" still needs an email the first
// time. Write path is unchanged from before this pass: POST /api/follow
// -> Supabase `followers`, upsert on (business_id, email) — see that
// route for the actual persistence; this component only decides how the
// email is collected.
//
// Clean V1 email-capture UX pass — email collection moved out of an
// inline expansion beside the logo (which used to distort the identity
// row on mobile and could show its error text right in that header
// area) into a modal/bottom-sheet, portaled into document.body for the
// same reason HamburgerMenu's drawer is: its geometry then can't be
// affected by anything in the identity row's own layout, regardless of
// what that row does now or later. The main profile button never
// changes shape — it's always either "Follow" or "✓ Following"; the
// email form and any submission error live entirely inside the modal.
export default function FollowButton({
  businessId,
  businessSlug,
  businessName,
  /** "compact" is purely a sizing/typography variant (h-9/text-xs vs
   * h-12/text-sm) for the resting Follow/Following pill — every behavior
   * (follow/unfollow, email capture, error handling) is identical between
   * the two sizes. The modal itself doesn't vary by this prop. */
  size = "default",
}: {
  businessId: string;
  businessSlug: string;
  businessName: string;
  size?: "default" | "compact";
}) {
  const [following, setFollowing] = useState(false);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFollowing(isFollowed(businessSlug));
  }, [businessSlug]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKeyDown);
    // Autofocus the email field the moment the sheet is actually visible.
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      clearTimeout(focusTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function openModal() {
    setStatus("idle");
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setEmail("");
    setStatus("idle");
    buttonRef.current?.focus();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setStatus("loading");
    try {
      const res = await fetch("/api/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, email: trimmed }),
      });
      if (res.ok) {
        markFollowed(businessSlug);
        setFollowing(true);
        setOpen(false);
        setEmail("");
        setStatus("idle");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  const compact = size === "compact";
  const h = compact ? "h-9" : "h-12";
  const text = compact ? "text-xs" : "text-sm";

  if (following) {
    // "✓ Following" no longer fits the compact 96px-wide button without
    // crowding it — collapsed to a checkmark-only state (still aqua,
    // same button footprint) with the meaning carried by aria-label/
    // title instead of visible text, rather than widening the button.
    return (
      <span
        role="status"
        aria-label="Following"
        title="Following"
        className={`flex ${h} w-full items-center justify-center rounded-full bg-findmi text-white`}
      >
        <CheckGlyph className="h-4 w-4" />
      </span>
    );
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={openModal}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex ${h} w-full items-center justify-center rounded-full bg-findmi ${text} font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600`}
      >
        Follow
      </button>

      {mounted &&
        open &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
            <div onClick={close} className="fixed inset-0 bg-black/40" />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`Follow ${businessName}`}
              className="relative w-full rounded-t-3xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-xl sm:max-w-sm sm:rounded-3xl sm:pb-5"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-display text-lg font-bold tracking-tight text-ink">Follow {businessName}</h2>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink/50 transition hover:bg-black/[0.03] hover:text-ink"
                >
                  <CloseGlyph className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-1.5 text-sm text-ink/60">
                Enter your email to follow this business and get future updates.
              </p>

              <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
                <input
                  ref={inputRef}
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address"
                  className="h-12 w-full rounded-xl border border-black/10 bg-white px-4 text-sm text-ink placeholder:text-ink/40 focus:border-ink/30 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={status === "loading"}
                  className="flex h-12 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-60"
                >
                  {status === "loading" ? "…" : "Follow"}
                </button>
                {status === "error" && (
                  <p className="text-xs text-red-600">Couldn&rsquo;t follow. Please try again.</p>
                )}
                <button
                  type="button"
                  onClick={close}
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

function CheckGlyph({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className}>
      <path
        d="M4 10.5l3.5 3.5L16 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
