"use client";

import { useEffect, useState } from "react";
import { isFollowed, markFollowed } from "@/lib/followed";

// The single Follow action for a business profile — Follow / Following.
// No accounts exist yet, so "following" still needs an email the first
// time; the button itself expands into that one-field capture instead of
// duplicating a whole separate follow section elsewhere on the page.
export default function FollowButton({
  businessId,
  businessSlug,
  /** Final refinement pass, item 1 — Follow moved into a compact Follow +
   * Save row right under the description, no longer the large primary-
   * looking button it was when it shared the row with Inquire. "compact"
   * is purely a sizing/typography variant (h-9/text-xs vs h-12/text-sm) —
   * every state, every behavior (follow/unfollow, email capture, error
   * handling) is byte-identical between the two sizes. */
  size = "default",
}: {
  businessId: string;
  businessSlug: string;
  size?: "default" | "compact";
}) {
  const [following, setFollowing] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    setFollowing(isFollowed(businessSlug));
  }, [businessSlug]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("loading");
    try {
      const res = await fetch("/api/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, email: email.trim() }),
      });
      if (res.ok) {
        markFollowed(businessSlug);
        setFollowing(true);
        setCapturing(false);
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
    return (
      <span className={`flex ${h} w-full items-center justify-center gap-1.5 rounded-full bg-findmi ${text} font-bold uppercase tracking-wide text-white`}>
        <CheckGlyph /> Following
      </span>
    );
  }

  if (capturing) {
    // Visual polish pass item 6: the error label used to sit as a THIRD
    // item inside the input+button row, squeezing the email input and
    // reading as another competing action next to Inquire/Follow/Save.
    // It's now a contextual line under the Follow control instead — the
    // form row itself always stays exactly input+button, so it never
    // shoves or resizes its siblings. Same retry mechanism as before (the
    // form stays open/editable — this was always a status label, not its
    // own retry button), just presented correctly.
    return (
      <div className="w-full">
        <form onSubmit={handleSubmit} className={`flex ${h} w-full items-center gap-1.5`}>
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            className="h-full min-w-0 flex-1 rounded-full border border-black/10 bg-white px-3.5 text-xs text-ink placeholder:text-ink/40 focus:border-ink/30 focus:outline-none"
          />
          <button
            type="submit"
            disabled={status === "loading"}
            className="h-full shrink-0 rounded-full bg-findmi px-4 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-60"
          >
            {status === "loading" ? "…" : "Follow"}
          </button>
        </form>
        {status === "error" && (
          <p className="mt-1.5 px-1 text-xs text-red-600">Couldn&rsquo;t follow — try again.</p>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setCapturing(true)}
      className={`flex ${h} w-full items-center justify-center rounded-full bg-findmi ${text} font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600`}
    >
      Follow
    </button>
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
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
