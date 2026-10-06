// Opportunities V1 — date/timing display for commercial Opportunities
// (Eastern time, matching how Admin enters them). Client- and server-safe.

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

