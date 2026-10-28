"use client";

import { useFormStatus } from "react-dom";

/** Submit button for Build My Brand Profile — shows the analysis is
 * running and prevents double submission. No data, no lookups. */
export default function BuildProfileButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="flex h-12 w-full items-center justify-center rounded-2xl bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-70"
    >
      {pending ? "Reading Your Website…" : "Import From Website"}
    </button>
  );
}
