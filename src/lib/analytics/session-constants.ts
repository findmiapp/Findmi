// Client-safe analytics identifier constants (session.ts itself imports
// next/headers, so client components import from here).

/** findmi_sid / findmi_acq lifetime. Privacy Choices (Phase 2A) reduced
 * this from 2 years to 90 days. */
export const ANALYTICS_IDENTIFIER_MAX_AGE_DAYS = 90;
