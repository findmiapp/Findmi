"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const ENDPOINT = { business: "/api/account/follow", event: "/api/account/follow-event" } as const;

/** Small overlay "×" on each card in /account/following — this account
 * is already confirmed following every item shown on this page (that's
 * why it's here), so a single POST always toggles it OFF; it never needs
 * to check current state first the way the public Follow buttons do.
 * router.refresh() re-runs the page's own server query afterward, so the
 * removed card simply stops appearing rather than needing local list
 * state here. */
export default function FollowingUnfollowButton({ kind, slug }: { kind: "business" | "event"; slug: string }) {
  const [pending, startTransition] = useTransition();
  const [hidden, setHidden] = useState(false);
  const router = useRouter();

  if (hidden) return null;

  return (
    <button
      type="button"
      disabled={pending}
      aria-label="Unfollow"
      title="Unfollow"
      onClick={() => {
        startTransition(async () => {
          try {
            await fetch(ENDPOINT[kind], {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ slug }),
            });
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
