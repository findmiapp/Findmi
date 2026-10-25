import "server-only";
// Server half of Privacy Choices (see ./consent.ts for the rules). Reads
// the device choice and GPC from the request, the account's saved choices
// from privacy_preferences (as the user, under RLS), and writes the device
// cookie. Never stores an IP address, IP hash or user agent.
import { cookies, headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PRIVACY_COOKIE,
  PRIVACY_COOKIE_MAX_AGE_SECONDS,
  analyticsAllowed,
  isAnalyticsChoice,
  isGpcHeader,
  parsePrivacyCookie,
  serializePrivacyCookie,
  type AnalyticsChoice,
} from "./consent";
import { ANALYTICS_ACQUISITION_COOKIE, ANALYTICS_SESSION_COOKIE } from "@/lib/analytics/session";

export interface AccountPrivacy {
  analyticsChoice: AnalyticsChoice | null;
  personalizedDiscovery: boolean;
  marketingEmail: boolean;
}

export const DEFAULT_ACCOUNT_PRIVACY: AccountPrivacy = {
  analyticsChoice: null,
  personalizedDiscovery: true,
  marketingEmail: false,
};

export async function readDeviceChoice(): Promise<AnalyticsChoice | null> {
  const store = await cookies();
  return parsePrivacyCookie(store.get(PRIVACY_COOKIE)?.value);
}

export async function readGpc(): Promise<boolean> {
  const h = await headers();
  return isGpcHeader(h.get("sec-gpc"));
}

/** The signed-in person's saved choices. A missing row (or a database
 * without the table yet) reads as the defaults: no analytics choice,
 * personalized discovery on (today's behavior), marketing off. */
export async function getAccountPrivacy(supabase: SupabaseClient, userId: string): Promise<AccountPrivacy> {
  try {
    const { data, error } = await supabase
      .from("privacy_preferences")
      .select("analytics_choice, personalized_discovery, marketing_email")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return { ...DEFAULT_ACCOUNT_PRIVACY };
    const row = data as { analytics_choice: string | null; personalized_discovery: boolean; marketing_email: boolean };
    return {
      analyticsChoice: isAnalyticsChoice(row.analytics_choice) ? row.analytics_choice : null,
      personalizedDiscovery: row.personalized_discovery !== false,
      marketingEmail: row.marketing_email === true,
    };
  } catch {
    return { ...DEFAULT_ACCOUNT_PRIVACY };
  }
}

/** Upserts the signed-in person's own row (RLS: own row only). Only the
 * fields supplied change. Returns whether the write succeeded. */
export async function saveAccountPrivacy(
  supabase: SupabaseClient,
  userId: string,
  patch: Partial<AccountPrivacy>
): Promise<boolean> {
  const row: Record<string, unknown> = { user_id: userId };
  if (patch.analyticsChoice !== undefined) {
    row.analytics_choice = patch.analyticsChoice;
    row.analytics_choice_at = new Date().toISOString();
  }
  if (patch.personalizedDiscovery !== undefined) row.personalized_discovery = patch.personalizedDiscovery;
  if (patch.marketingEmail !== undefined) row.marketing_email = patch.marketingEmail;
  try {
    const { error } = await supabase.from("privacy_preferences").upsert(row, { onConflict: "user_id" });
    return !error;
  } catch {
    return false;
  }
}

/** Writes the device choice cookie. Must run in a Route Handler or Server
 * Action. A refusal also removes any existing analytics identifiers from
 * this browser, so nothing keeps correlating after "Essential Only". */
export async function writeDeviceChoice(choice: AnalyticsChoice): Promise<void> {
  const store = await cookies();
  store.set(PRIVACY_COOKIE, serializePrivacyCookie(choice), {
    httpOnly: false, // the client tracker reads it to avoid sending beacons at all
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PRIVACY_COOKIE_MAX_AGE_SECONDS,
  });
  if (choice === "denied") {
    store.delete(ANALYTICS_SESSION_COOKIE);
    store.delete(ANALYTICS_ACQUISITION_COOKIE);
  }
}

/** The single server-side analytics gate for a request. `accountChoice`
 * is only consulted for a signed-in request. */
export async function isAnalyticsAllowedForRequest(supabase: SupabaseClient | null, userId: string | null): Promise<boolean> {
  const deviceChoice = await readDeviceChoice();
  if (deviceChoice !== "granted") return false; // cheap exit before any DB read
  if (!supabase || !userId) return analyticsAllowed({ deviceChoice });
  const account = await getAccountPrivacy(supabase, userId);
  return analyticsAllowed({ deviceChoice, accountChoice: account.analyticsChoice });
}
