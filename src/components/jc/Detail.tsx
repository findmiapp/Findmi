"use client";

import { useRouter } from "next/navigation";
import { jcHref } from "@/lib/jc/config";

/** Floating back control over detail media — history back when there is
 * one, otherwise the given fallback. */
export function BackButton({ fallback }: { fallback: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label="Back"
      onClick={() => (window.history.length > 1 ? router.back() : router.push(jcHref(fallback)))}
      className="absolute left-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-neutral-900 shadow-[0_1px_8px_rgba(0,0,0,0.12)] backdrop-blur active:scale-95"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
        <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export function ShareButton({ title }: { title: string }) {
  return (
    <button
      type="button"
      aria-label="Share"
      onClick={async () => {
        const url = window.location.href;
        try {
          if (navigator.share) await navigator.share({ title, url });
          else await navigator.clipboard.writeText(url);
        } catch {
          /* dismissed */
        }
      }}
      className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-neutral-900 shadow-[0_1px_8px_rgba(0,0,0,0.12)] backdrop-blur active:scale-95"
    >
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden>
        <path d="M12 15V4M8 8l4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
