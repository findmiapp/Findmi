"use client";

import { useEffect } from "react";
import Link from "next/link";

/** Public route-group error boundary. Before this existed, any uncaught
 * client exception on a public page replaced the entire document with
 * Next.js's bare "Application error: a client-side exception has occurred"
 * (2026-11-02 incident). Now the site chrome (header/nav from the group
 * layout) stays, the visitor gets a way to retry, and the error is logged.
 * Sections that can fail on their own are also wrapped individually
 * (components/SectionErrorBoundary) so this is the last line, not the first. */
export default function PublicError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[Findmi] Page failed to render.", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-start px-6 py-24">
      <p className="text-sm font-semibold text-ink/50">Something Went Wrong</p>
      <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-ink">This page didn&rsquo;t load properly.</h1>
      <p className="mt-3 text-sm text-ink/60">Try again — if it keeps happening, it&rsquo;s on us and we&rsquo;re looking into it.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-findmi px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Try Again
        </button>
        <Link href="/" className="rounded-full border border-black/10 px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-ink transition hover:border-black/25">
          Back to Findmi
        </Link>
      </div>
    </div>
  );
}
