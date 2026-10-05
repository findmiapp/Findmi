"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Moments V2 — the one small sheet the composer uses for focused,
 * secondary tasks (a photo note, moving photos between sections, choosing
 * a section type, confirmations). A bottom sheet on phones, a centered
 * card on wider screens; rendered into document.body so nothing in the
 * page (overflow-hidden tiles, sticky headers) can clip it. Closes on a
 * backdrop tap or Escape. */
export default function MomentSheet({
  title,
  description,
  onClose,
  children,
  footer,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[85vh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-xl sm:mx-4 sm:rounded-3xl">
        <div className="px-5 pb-2 pt-4">
          <span className="mx-auto mb-3 block h-1 w-10 rounded-full bg-black/10 sm:hidden" />
          <h2 className="font-display text-base font-bold tracking-tight text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-ink/55">{description}</p>}
        </div>
        {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">{children}</div>}
        {footer && <div className="flex flex-col gap-2 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
