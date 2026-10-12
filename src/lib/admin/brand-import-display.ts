/** Brand Ingestion P3 — display labels for the Admin Import Brands pages
 * (pure; no server imports). */

export const BRAND_IMPORT_STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  processing: "Processing",
  ready: "Ready",
  existing_business: "Existing On Findmi",
  failed: "Failed",
  creating: "Creating",
  created: "Created",
  discarded: "Discarded",
};

/** Safe failure codes → readable labels (unknown codes show as-is). */
export const BRAND_IMPORT_FAILURE_LABEL: Record<string, string> = {
  invalid_input: "Not A Website",
  unsupported_site: "Unsupported Site",
  dns_failed: "Domain Not Found",
  timeout: "Website Timed Out",
  blocked_destination: "Blocked Destination",
  redirect_loop: "Redirect Loop",
  too_many_redirects: "Too Many Redirects",
  redirect_rejected: "Redirect Rejected",
  blocked_by_site: "Blocked By Website",
  http_error: "Website Error",
  unsupported_content: "Not An HTML Page",
  too_large: "Page Too Large",
  network_error: "Network Error",
  no_metadata: "No Brand Details Found",
  match_failed: "Matching Failed",
  invalid_proposal: "Invalid Candidate",
  internal_error: "Internal Error",
};

export const BRAND_IMPORT_AI_LABEL: Record<string, string> = { used: "AI Used", skipped: "AI Skipped", failed: "AI Failed" };

export function brandImportFailureLabel(code: string | null): string | null {
  if (!code) return null;
  return BRAND_IMPORT_FAILURE_LABEL[code] ?? code;
}

/** "$0.0135" style, or null when unknown. */
export function formatAiCost(usd: number | null | undefined): string | null {
  if (usd == null || !Number.isFinite(usd)) return null;
  return `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;
}
