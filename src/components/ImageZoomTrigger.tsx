"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import ImageLightbox from "./ImageLightbox";

/** Field QA UX Pass 2 — makes an existing public image (logo, cover,
 * product photo) open the shared ImageLightbox (swipe, Escape, close,
 * backdrop) instead of looking tappable and doing nothing. Renders a
 * transparent button over the image's own positioned container — place it
 * inside that `relative` box. Only ever used where a REAL image exists;
 * placeholders/initials never get one. `images` is the real related set
 * (e.g. cover + that entity's own gallery), never unrelated page imagery. */
export default function ImageZoomTrigger({
  images,
  alt,
  label,
  className = "",
}: {
  images: string[];
  alt: string;
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }
  if (images.length === 0) return null;
  return (
    <>
      <button ref={buttonRef} type="button" onClick={() => setOpen(true)} aria-label={label} className={`absolute inset-0 z-[1] cursor-zoom-in rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-findmi ${className}`} />
      {/* Portaled so no ancestor stacking context (sticky headers, rounded
          overflow-hidden frames) can sit above or clip the viewer. */}
      {open && createPortal(<ImageLightbox images={images} initialIndex={0} alt={alt} onClose={close} />, document.body)}
    </>
  );
}
