import type { ListingStatus, RecipientStatus } from "@/lib/opportunity-listings-domain";

// Opportunities V1 — Admin-only badge styles. Date/timing formatters are
// shared with the commercial presentation (src/lib/opportunity-format.ts).
export { formatOpportunityDate, formatOpportunityDateTime, formatOpportunityTiming } from "@/lib/opportunity-format";

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
