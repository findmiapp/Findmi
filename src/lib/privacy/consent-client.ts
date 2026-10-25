"use client";
// Client half of Privacy Choices (rules in ./consent.ts). Reads the device
// choice from the findmi_privacy cookie and the GPC signal from the
// browser. Writes always go through /api/privacy/choices so the server
// sets the cookie and, when signed in, the account preference.
import {
  OPEN_PRIVACY_CHOICES_EVENT,
  PRIVACY_CHOICE_CHANGED_EVENT,
  PRIVACY_COOKIE,
  parsePrivacyCookie,
  type AnalyticsChoice,
} from "./consent";

export function readClientDeviceChoice(): AnalyticsChoice | null {
  if (typeof document === "undefined") return null;
  try {
    const match = document.cookie.split("; ").find((c) => c.startsWith(`${PRIVACY_COOKIE}=`));
    return parsePrivacyCookie(match ? decodeURIComponent(match.slice(PRIVACY_COOKIE.length + 1)) : null);
  } catch {
    return null;
  }
}

export function readClientGpc(): boolean {
  if (typeof navigator === "undefined") return false;
  return (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

/** The client-side analytics gate: only an explicit grant on this device.
 * The server re-checks every beacon (including the account's choice). */
export function isAnalyticsAllowedClient(): boolean {
  return readClientDeviceChoice() === "granted";
}

export function openPrivacyChoices(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_PRIVACY_CHOICES_EVENT));
}

export interface PrivacyChoicesState {
  signedIn: boolean;
  gpc: boolean;
  analytics: AnalyticsChoice | null;
  account: { personalizedDiscovery: boolean; marketingEmail: boolean } | null;
}

async function post(body: Record<string, unknown>): Promise<PrivacyChoicesState> {
  const res = await fetch("/api/privacy/choices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, gpc: readClientGpc() }),
  });
  const json = (await res.json().catch(() => null)) as (PrivacyChoicesState & { error?: string }) | null;
  if (!res.ok || !json || json.error) throw new Error(json?.error ?? "Couldn't save your choices. Please try again.");
  return json;
}

export async function fetchPrivacyChoices(): Promise<PrivacyChoicesState> {
  const res = await fetch("/api/privacy/choices", { cache: "no-store" });
  const json = (await res.json()) as PrivacyChoicesState;
  return { ...json, gpc: json.gpc || readClientGpc() };
}

export async function savePrivacyChoices(choices: {
  analytics?: AnalyticsChoice;
  personalizedDiscovery?: boolean;
  marketingEmail?: boolean;
}): Promise<PrivacyChoicesState> {
  const state = await post({ action: "set", ...choices });
  if (choices.analytics) window.dispatchEvent(new CustomEvent(PRIVACY_CHOICE_CHANGED_EVENT, { detail: choices.analytics }));
  return state;
}

export async function syncPrivacyChoices(): Promise<PrivacyChoicesState> {
  const before = readClientDeviceChoice();
  const state = await post({ action: "sync" });
  const after = readClientDeviceChoice();
  if (after && after !== before) window.dispatchEvent(new CustomEvent(PRIVACY_CHOICE_CHANGED_EVENT, { detail: after }));
  return state;
}
