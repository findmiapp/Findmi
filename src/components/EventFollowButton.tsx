"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isEventFollowed, markEventFollowed } from "@/lib/followedEvents";
import { getAccountSession } from "@/lib/accountSession";

// Restore Event Follow pass — exact event-side mirror of
// components/FollowButton.tsx's Follow/Following toggle. Guest path:
// email-capture modal → POST /api/follow-event → the existing, untouched
// `event_followers` table. Signed-in path: no email prompt, writes
// straight to account_followed_events via POST /api/account/follow-event.
// Deliberately its own component (not a generic <FollowButton kind=...>)
// so a future Business-only or Event-only behavior change never risks
// the other — same reasoning FollowButton.tsx's own header already
// documents for keeping the guest/authed paths separate internally.
export default function EventFollowButton({
  eventId,
  eventSlug,
  eventName,
  size = "default",
}: {
  eventId: string;
  eventSlug: string;
  eventName: string;
  size?: "default" | "compact";
}) {
  const [following, setFollowing] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFollowing(isEventFollowed(eventId));

    let cancelled = false;
    getAccountSession().then((isAuthed) => {
      if (cancelled || !isAuthed) return;
      setAuthed(true);
      fetch(`/api/account/follow-event?slug=${encodeURIComponent(eventSlug)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { following?: boolean } | null) => {
          if (!cancelled && data) setFollowing(Boolean(data.following));
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [eventId, eventSlug]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKeyDown);
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
      const res = await fetch("/api/follow-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, email: trimmed }),
      });
      if (res.ok) {
        markEventFollowed(eventId);
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

  async function handleAuthedFollow() {
    try {
      const res = await fetch("/api/account/follow-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: eventSlug }),
      });
      if (res.ok) {
        const data = (await res.json()) as { following?: boolean };
        setFollowing(Boolean(data.following));
      }
    } catch {
      // Best-effort — button just stays in its current state on failure.
    }
  }

  const compact = size === "compact";
  const h = compact ? "h-9" : "h-11";
  const text = compact ? "text-xs" : "text-sm";

  if (following) {
    // A guest's "Following" is a per-device localStorage flag, not a
    // real identity anything can look up to unfollow — same reasoning
    // FollowButton.tsx's own guest-following state is a non-interactive
    // status chip, not a button. Only the authed path (a real
    // account_followed_events row this session actually owns) gets a
    // real tap-to-unfollow toggle.
    if (!authed) {
      return (
        <span
          role="status"
          aria-label="Following"
          title="Following"
          className={`flex ${h} items-center gap-1.5 rounded-full bg-findmi px-4 ${text} font-bold uppercase tracking-wide text-white`}
        >
          <CheckGlyph className="h-3.5 w-3.5" />
          Following
        </span>
      );
    }
    return (
      <button
        type="button"
        onClick={handleAuthedFollow}
        title="Following — tap to unfollow"
        className={`flex ${h} items-center gap-1.5 rounded-full bg-findmi px-4 ${text} font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600`}
      >
        <CheckGlyph className="h-3.5 w-3.5" />
        Following
      </button>
    );
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={authed ? handleAuthedFollow : openModal}
        aria-haspopup={authed ? undefined : "dialog"}
        aria-expanded={authed ? undefined : open}
        className={`flex ${h} items-center justify-center rounded-full bg-findmi px-4 ${text} font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600`}
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
              aria-label={`Follow ${eventName}`}
              className="relative w-full rounded-t-3xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-xl sm:max-w-sm sm:rounded-3xl sm:pb-5"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-display text-lg font-bold tracking-tight text-ink">Follow {eventName}</h2>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink/50 transition hover:bg-black/[0.03] hover:text-ink"
                >
                  <CloseGlyph className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-1.5 text-sm text-ink/60">Enter your email to follow this event and get future updates.</p>

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
                {status === "error" && <p className="text-xs text-red-600">Couldn&rsquo;t follow. Please try again.</p>}
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
      <path d="M4 10.5l3.5 3.5L16 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
