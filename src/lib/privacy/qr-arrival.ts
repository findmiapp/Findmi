// Deferred QR measurement (Privacy Choices, Phase 2A). Pure helpers shared
// by /q/[code] (which adds the marker) and the client (which removes it).
//
// When a visitor who hasn't made a privacy choice yet scans a Findmi QR
// code, the redirect still happens immediately, but nothing is measured.
// Internal destinations carry ?fmqr=<code> so that IF the person then
// allows Analytics on that page, the scan can be recorded once
// (/api/analytics/qr-arrival). Choosing Essential Only removes the marker
// and records nothing. External destinations never get the marker.

export const QR_ARRIVAL_PARAM = "fmqr";

const CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isQrArrivalCode(value: unknown): value is string {
  return typeof value === "string" && CODE_RE.test(value);
}

/** Adds ?fmqr=<code> to an internal ("/...") destination. Absolute or
 * otherwise non-internal destinations are returned unchanged. */
export function withQrArrivalParam(destination: string, code: string): string {
  if (!destination.startsWith("/") || destination.startsWith("//") || !isQrArrivalCode(code)) return destination;
  const hashIndex = destination.indexOf("#");
  const base = hashIndex === -1 ? destination : destination.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : destination.slice(hashIndex);
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${QR_ARRIVAL_PARAM}=${encodeURIComponent(code)}${hash}`;
}

/** Splits the marker out of a URL search string: the code (if valid) and
 * the search string without it. */
export function takeQrArrivalParam(search: string): { code: string | null; search: string } {
  const params = new URLSearchParams(search);
  const raw = params.get(QR_ARRIVAL_PARAM);
  params.delete(QR_ARRIVAL_PARAM);
  const rest = params.toString();
  return { code: isQrArrivalCode(raw) ? raw : null, search: rest ? `?${rest}` : "" };
}
