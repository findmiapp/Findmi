"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ACCOUNT_FOLLOW_ENDPOINT } from "@/lib/account-follow-client";

const ENDPOINT = ACCOUNT_FOLLOW_ENDPOINT;

/** Small overlay "×" on each card in /account/following. Always sends
 * the explicit desired state `following: false` — never the legacy
 * toggle — so a stale page (already unfollowed in another tab) can never
 * re-follow anything; repeating it is harmless. The card hides only once
 * the server confirms; router.refresh() then re-runs the page's own
 * server query so the removed card simply stops appearing. */
export default function FollowingUnfollowButton({
  kind,
  slug,
  name,
}: {
  kind: "business" | "event" | "location";
  slug: string;
  /** For the accessible label ("Unfollow <name>"). */
  name: string;
}) {
  const [pending, startTransition] = useTransition();
  const [hidden, setHidden] = useState(false);
  const router = useRouter();

  if (hidden) return null;

  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`Unfollow ${name}`}
      title={`Unfollow ${name}`}
      onClick={() => {
        startTransition(async () => {
          try {
            const res = await fetch(ENDPOINT[kind], {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ slug, following: false }),
            });
            if (!res.ok) return; // stays visible and clickable
            setHidden(true);
            router.refresh();
          } catch {
            // Best-effort — button just stays clickable on failure.
          }
        });
      }}
      className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition hover:bg-black/70 disabled:opacity-50"
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3">
        <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </button>
  );
}
