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

export interface BrandImageReviewItem {
  role: "cover" | "logo";
  label: "Cover" | "Logo";
  field: "use_cover" | "use_logo";
  preview: string | null;
  /** Default selection of the Keep/Remove control. */
  keep: boolean;
}

/** P4 review — Keep/Remove defaults for the candidate images. A verified
 * preview defaults to Keep (unless the saved review removed it); an image
 * that can't be previewed defaults to Remove — only an explicit, saved
 * Keep counts. `undecided` lists unpreviewable images with no saved
 * decision: Create stays unavailable until the review is saved, because
 * creation keeps an undecided image. */
export function brandImageReviewItems(
  proposal: { cover?: string; logo?: string; useCover?: boolean; useLogo?: boolean } | null,
  previews: { cover: string | null; logo: string | null }
): { items: BrandImageReviewItem[]; undecided: ("cover" | "logo")[] } {
  if (!proposal) return { items: [], undecided: [] };
  const slots = [
    { role: "cover", label: "Cover", field: "use_cover", url: proposal.cover, saved: proposal.useCover },
    { role: "logo", label: "Logo", field: "use_logo", url: proposal.logo, saved: proposal.useLogo },
  ] as const;
  const items: BrandImageReviewItem[] = [];
  const undecided: ("cover" | "logo")[] = [];
  for (const s of slots) {
    if (!s.url) continue;
    const preview = previews[s.role];
    items.push({ role: s.role, label: s.label, field: s.field, preview, keep: preview ? s.saved !== false : s.saved === true });
    if (!preview && s.saved === undefined) undecided.push(s.role);
  }
  return { items, undecided };
}
