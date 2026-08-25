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
}: {
  businessId: string;
  businessSlug: string;
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

  // w-full/h-12 on every state (this component has exactly one caller —
  // the business profile's primary action row, UI cleanup pass item 1) so
  // Follow reads as a real, proportioned secondary CTA next to Inquire
  // instead of a small content-sized pill lost in the row.
  if (following) {
    return (
      <span className="flex h-12 w-full items-center justify-center gap-1.5 rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white">
        <CheckGlyph /> Following
      </span>
    );
  }

  if (capturing) {
    return (
      <form onSubmit={handleSubmit} className="flex h-12 w-full items-center gap-1.5">
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
        {status === "error" && (
          <span className="shrink-0 text-xs text-red-600">Try again</span>
        )}
      </form>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setCapturing(true)}
      className="flex h-12 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
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
