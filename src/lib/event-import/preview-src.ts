// Admin Event Import — the ONLY values an Admin Review image may hand to the
// browser. The page CSP allows Findmi / data: images, not third-party hosts
// (and stays that way), and a source Event image URL is persistence input
// for recoverEventImage — never a display value. A preview is shown only
// when it is a verified, server-made `data:image/*;base64` URI; anything
// else (a remote URL, an empty value) renders "No Preview Available".
// Pure; no I/O.

const SAFE_PREVIEW = /^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
/** Generous bound for a 120 KB WebP as base64 plus its prefix. */
const MAX_PREVIEW_CHARS = 200_000;

export function safePreviewSrc(value: unknown): string | null {
  return typeof value === "string" && value.length <= MAX_PREVIEW_CHARS && SAFE_PREVIEW.test(value) ? value : null;
}

export type ImagePreviewState = { status: "loading" } | { status: "ok"; src: string } | { status: "failed"; reason: string };
