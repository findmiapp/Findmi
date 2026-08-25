"use client";

import { useEffect, useState } from "react";
import { isProductSaved, toggleProductSaved } from "@/lib/saved";

// Same per-device bookmark pattern as SaveButton (businesses) and
// EventSaveButton — Product Detail V2 extends it to products rather than
// inventing a new save mechanism.
export default function ProductSaveButton({ slug }: { slug: string }) {
  const [saved, setSaved] = useState(false);

  // Read after mount only — localStorage isn't available during SSR, and
  // reading it during render would mismatch the server-rendered markup.
  useEffect(() => {
    setSaved(isProductSaved(slug));
  }, [slug]);

  return (
    <button
      type="button"
      onClick={() => setSaved(toggleProductSaved(slug))}
      aria-pressed={saved}
      aria-label={saved ? "Remove from Saved" : "Save"}
      className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full border border-black/10 text-sm font-semibold text-ink transition active:scale-[0.98]"
    >
      <svg viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} className="h-4 w-4 shrink-0">
        <path
          d="M6 4h12a1 1 0 011 1v15l-7-4-7 4V5a1 1 0 011-1z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
      {saved ? "Saved" : "Save"}
    </button>
  );
}
