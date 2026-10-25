// Findmi Privacy Choices — the ONE shared definition of how a person's
// privacy choices are stored on a device and how they decide what Findmi
// may collect. Pure and dependency-free so the server (ingestion route,
// QR route, choices API), the client tracker and the tests all use exactly
// the same rules (tests/privacy-consent.test.mjs).
//
// Categories:
//   Essential               always on: sign-in, security, sessions, cart,
//                           saved items on this device, and this very
//                           preference. No off switch.
//   Analytics               optional first-party Findmi analytics (the
//                           findmi_sid / findmi_acq identifiers and every
//                           analytics_events row). OFF until "granted".
//   Personalized Discovery  account-only ranking by the person's own
//                           explicit actions (lib/discovery/server.ts).
//   Marketing Emails        account-only, future non-transactional email.
//
// Findmi has no advertising or cross-site tracking, so there is no
// advertising category to switch off.
//
// Device storage: one first-party cookie, findmi_privacy, holding only the
// analytics choice ("v1.granted" / "v1.denied"). A cookie (not
// localStorage) so the server can enforce it on every request without
// trusting the client. It stores a choice, never an identifier.

export const PRIVACY_COOKIE = "findmi_privacy";
/** How long a device remembers an explicit choice (12 months). */
export const PRIVACY_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type AnalyticsChoice = "granted" | "denied";

export function isAnalyticsChoice(value: unknown): value is AnalyticsChoice {
  return value === "granted" || value === "denied";
}

const COOKIE_PREFIX = "v1.";

export function serializePrivacyCookie(choice: AnalyticsChoice): string {
  return `${COOKIE_PREFIX}${choice}`;
}

/** Unknown, malformed or missing values read as "no choice yet". */
export function parsePrivacyCookie(raw: string | null | undefined): AnalyticsChoice | null {
  if (!raw || !raw.startsWith(COOKIE_PREFIX)) return null;
  const value = raw.slice(COOKIE_PREFIX.length);
  return isAnalyticsChoice(value) ? value : null;
}

/** Global Privacy Control: the `Sec-GPC: 1` request header (server) or
 * `navigator.globalPrivacyControl === true` (client). */
export function isGpcHeader(value: string | null | undefined): boolean {
  return value?.trim() === "1";
}

/** THE collection rule. Analytics runs only when this device holds an
 * explicit "granted" AND the signed-in account (if any) has not chosen
 * "denied". No choice, a refusal, or an active GPC signal with no explicit
 * grant all mean OFF. An explicit grant made on this device after GPC was
 * detected is the person's own choice and is respected. */
export function analyticsAllowed(input: { deviceChoice: AnalyticsChoice | null; accountChoice?: AnalyticsChoice | null }): boolean {
  if (input.deviceChoice !== "granted") return false;
  if (input.accountChoice === "denied") return false;
  return true;
}

export interface ReconcileInput {
  /** The device's explicit choice (findmi_privacy cookie). */
  device: AnalyticsChoice | null;
  /** The signed-in account's saved choice (privacy_preferences). */
  account: AnalyticsChoice | null;
  /** Global Privacy Control active on this request/browser. */
  gpc: boolean;
}

export interface ReconcileResult {
  /** New device cookie value to write, or null to leave it unchanged. */
  setDevice: AnalyticsChoice | null;
  /** New account value to write, or null to leave it unchanged. */
  setAccount: AnalyticsChoice | null;
  /** The choice that now governs collection on this device. */
  effective: AnalyticsChoice | null;
}

/** Deterministic sign-in reconciliation between the device and the
 * account. Rules, in order:
 *   1. Both empty: nothing to do (the first-visit card still asks).
 *   2. Same value: nothing to do.
 *   3. Only the device has a choice: the account adopts it.
 *   4. Only the account has a choice: the device adopts it, EXCEPT that an
 *      account "granted" is not copied onto a device sending GPC (the
 *      signal stands until the person explicitly allows analytics here).
 *   5. They disagree: the refusal wins on both. Signing in never turns a
 *      refusal into consent; the person can re-allow at any time. */
export function reconcileAnalyticsChoice({ device, account, gpc }: ReconcileInput): ReconcileResult {
  if (!device && !account) return { setDevice: null, setAccount: null, effective: null };
  if (device === account) return { setDevice: null, setAccount: null, effective: device };
  if (device && !account) return { setDevice: null, setAccount: device, effective: device };
  if (!device && account) {
    if (account === "granted" && gpc) return { setDevice: null, setAccount: null, effective: null };
    return { setDevice: account, setAccount: null, effective: account };
  }
  return { setDevice: "denied", setAccount: "denied", effective: "denied" };
}

/** Whether the first-visit Privacy Choices card should appear: only when
 * there is no explicit device choice and no GPC signal (GPC already
 * expresses the person's choice; the card never nags after a decision). */
export function shouldShowFirstVisitCard(input: { deviceChoice: AnalyticsChoice | null; gpc: boolean }): boolean {
  return input.deviceChoice === null && !input.gpc;
}

/** Event other components dispatch on window to open Privacy Choices. */
export const OPEN_PRIVACY_CHOICES_EVENT = "findmi:open-privacy-choices";
/** Event fired after the device choice changes (detail: AnalyticsChoice). */
export const PRIVACY_CHOICE_CHANGED_EVENT = "findmi:privacy-choice-changed";
