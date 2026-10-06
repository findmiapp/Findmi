import type { ListingStatus, RecipientStatus } from "@/lib/opportunity-listings-domain";

// Opportunities V1 Pass 2 — Admin display helpers (Eastern time, like every
// other Admin date input).

const TZ = "America/New_York";

export function formatOpportunityDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" });
}

export function formatOpportunityDateTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "Nov 8, 2026 – Nov 15, 2026 · Two Saturdays" — whatever timing exists. */
export function formatOpportunityTiming(o: { starts_at: string | null; ends_at: string | null; timing_note: string | null }): string {
  const start = formatOpportunityDate(o.starts_at);
  const end = formatOpportunityDate(o.ends_at);
  const range = start && end && start !== end ? `${start} – ${end}` : start || end;
  return [range, o.timing_note].filter(Boolean).join(" · ");
}

export const STATUS_BADGE: Record<ListingStatus, string> = {
  draft: "bg-black/5 text-ink/55",
  open: "bg-findmi-50 text-findmi-700",
  closed: "bg-amber-50 text-amber-800",
  archived: "bg-black/5 text-ink/40",
};

export const RECIPIENT_BADGE: Record<RecipientStatus, string> = {
  offered: "bg-black/5 text-ink/60",
  interested: "bg-findmi-50 text-findmi-700",
  not_interested: "bg-black/5 text-ink/45",
  confirmed: "bg-findmi text-white",
  completed: "bg-ink text-white",
  cancelled: "bg-red-50 text-red-700",
  withdrawn: "bg-black/5 text-ink/40",
};
