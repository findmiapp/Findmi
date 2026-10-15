// Admin Event Import — what an image preview renders. Written without JSX
// so it can be rendered in tests (react-dom/server) and its final `src`
// checked directly. The browser only ever receives a verified data URI
// (safePreviewSrc); otherwise a "No Preview Available" box — never the
// source image URL.
import { createElement, type ReactElement } from "react";
import { safePreviewSrc, type ImagePreviewState } from "@/lib/event-import/preview-src";

export function ImagePreviewView({
  state,
  className,
  alt,
  compact = false,
  onError,
}: {
  state: ImagePreviewState;
  className: string;
  alt: string;
  /** Small thumbnail: shorter wording. */
  compact?: boolean;
  /** The browser couldn't display the data URI → show "No Preview Available". */
  onError?: () => void;
}): ReactElement {
  const src = state.status === "ok" ? safePreviewSrc(state.src) : null;
  if (src) return createElement("img", { src, alt, className, "data-image-preview": "verified", onError });
  const text =
    state.status === "loading"
      ? compact
        ? "…"
        : "Checking image…"
      : compact
        ? "No Preview"
        : `No Preview Available${state.status === "failed" && state.reason ? `: ${state.reason}` : ""}. Saving checks the image again; if it fails then, no image is saved.`;
  return createElement(
    "span",
    {
      className: `${className} flex items-center justify-center p-1 text-center text-microcopy ${state.status === "failed" ? "text-amber-900" : "text-muted"}`,
      "data-image-preview": state.status === "loading" ? "loading" : "none",
      role: state.status === "loading" ? undefined : "img",
      "aria-label": state.status === "loading" ? undefined : "No Preview Available",
    },
    text
  );
}
