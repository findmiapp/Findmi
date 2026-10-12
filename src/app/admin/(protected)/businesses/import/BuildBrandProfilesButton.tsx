"use client";

import { useFormStatus } from "react-dom";

/** Submit for Import Brands — prevents double submission. */
export default function BuildBrandProfilesButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="rounded-full bg-findmi px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-70"
    >
      {pending ? "Creating Import…" : "Build Brand Profiles"}
    </button>
  );
}
