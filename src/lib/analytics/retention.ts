// Analytics retention (Trust & Privacy Phase 2A). Findmi sets no default
// legal retention period in code: ANALYTICS_RETENTION_DAYS decides it, and
// until it is set the admin action is unavailable.
//
// Retention de-identifies rather than deletes, so Business performance
// totals keep their counts: rows older than the cutoff lose their account
// link and referrer, and every one of them is given the same placeholder
// session id, so they can no longer be tied to a person or a device.

/** Shared placeholder for de-identified rows (session_id is NOT NULL). */
export const RETIRED_SESSION_ID = "00000000-0000-0000-0000-000000000000";

/** Lower bound so a typo can never de-identify recent data. */
export const ANALYTICS_RETENTION_MIN_DAYS = 30;

/** The configured retention in days, or null when unset or invalid. */
export function parseAnalyticsRetentionDays(raw: string | undefined | null): number | null {
  if (raw == null || raw.trim() === "") return null;
  if (!/^\d+$/.test(raw.trim())) return null;
  const days = Number(raw.trim());
  if (!Number.isSafeInteger(days) || days < ANALYTICS_RETENTION_MIN_DAYS || days > 3650) return null;
  return days;
}

/** The ISO cutoff: rows that occurred before it are de-identified. */
export function analyticsRetentionCutoff(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}
