"use client";

import Link from "next/link";

// Edit Appearance — contains a failure of this page or its actions (e.g. a
// "Convert To Event" request the host cut off) to this panel instead of
// the whole-app "Application error" screen. An interrupted action may
// still have finished its work, so the way forward is to reload the
// Appearance and look at its current state — never to assume it failed.
export default function AppearanceError({ error }: { error: Error & { digest?: string } }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
      <p className="font-semibold">This Request Didn&rsquo;t Finish</p>
      <p className="mt-1">
        The page lost its response from the server. The change may still have been saved — reload this Appearance to see
        its current state before trying again.
      </p>
      {error.digest && <p className="mt-2 text-xs text-red-700/70">Reference: {error.digest}</p>}
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg border border-red-300 bg-white px-3 py-1.5 font-semibold text-red-700 hover:border-red-400"
        >
          Reload Appearance
        </button>
        <Link href="/admin/appearances" className="rounded-lg px-3 py-1.5 font-semibold text-red-700 underline">
          All Appearances
        </Link>
      </div>
    </div>
  );
}
