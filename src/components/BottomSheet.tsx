"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

/** Shared bottom sheet (dialog on wider screens) for personal actions —
 * Want, Add to Collection. Escape / backdrop close. */
export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" role="presentation" onClick={(e) => e.stopPropagation()}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label={label} className="relative w-full max-w-md rounded-t-3xl bg-white px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 shadow-xl sm:rounded-3xl sm:pb-4">
        <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-full bg-black/10 sm:hidden" />
        {children}
      </div>
    </div>,
    document.body
  );
}

export function DoneButton({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" onClick={onClose} className="mt-5 h-11 w-full rounded-full bg-findmi text-sm font-semibold text-white">
      Done
    </button>
  );
}
