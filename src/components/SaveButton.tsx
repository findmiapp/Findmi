"use client";

import { useAccountSaved } from "@/lib/useAccountSaved";

export default function SaveButton({ slug }: { slug: string }) {
  const { saved, toggle } = useAccountSaved("business", slug);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={saved}
      aria-label={saved ? "Remove from Saved" : "Save"}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/10 text-ink transition active:scale-90"
    >
      <svg viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} className="h-4 w-4">
        <path
          d="M6 4h12a1 1 0 011 1v15l-7-4-7 4V5a1 1 0 011-1z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
