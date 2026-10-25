import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  getAccountPrivacy,
  readDeviceChoice,
  readGpc,
  saveAccountPrivacy,
  writeDeviceChoice,
  type AccountPrivacy,
} from "@/lib/privacy/consent-server";
import { isAnalyticsChoice, reconcileAnalyticsChoice, type AnalyticsChoice } from "@/lib/privacy/consent";
import { ANALYTICS_ACQUISITION_COOKIE, ANALYTICS_SESSION_COOKIE } from "@/lib/analytics/session";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

interface ChoicesState {
  signedIn: boolean;
  gpc: boolean;
  /** The device's explicit analytics choice (null = not decided). */
  analytics: AnalyticsChoice | null;
  /** Account-only preferences; null when signed out. */
  account: Pick<AccountPrivacy, "personalizedDiscovery" | "marketingEmail"> | null;
}

async function currentState(extraGpc = false): Promise<ChoicesState> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [device, gpcHeader] = await Promise.all([readDeviceChoice(), readGpc()]);
  const gpc = gpcHeader || extraGpc;
  if (!user) return { signedIn: false, gpc, analytics: device, account: null };
  const account = await getAccountPrivacy(supabase, user.id);
  return {
    signedIn: true,
    gpc,
    analytics: device,
    account: { personalizedDiscovery: account.personalizedDiscovery, marketingEmail: account.marketingEmail },
  };
}

/** Privacy Choices state for this device (and account, if signed in). */
export async function GET() {
  return NextResponse.json(await currentState());
}

/**
 * action "set": the person's explicit choice(s) from Privacy Choices.
 *   analytics             'granted' | 'denied'  (device, and account when signed in)
 *   personalizedDiscovery boolean               (account only)
 *   marketingEmail        boolean               (account only)
 * action "sync": sign-in reconciliation (lib/privacy/consent.ts
 *   reconcileAnalyticsChoice). Called by PrivacyChoicesRoot once per
 *   browser session for a signed-in visitor.
 * `gpc` (optional boolean) lets the browser report navigator.
 * globalPrivacyControl; it can only make the outcome more protective.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const action = body.action;
  const clientGpc = body.gpc === true;

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (action === "sync") {
    if (!user) return NextResponse.json(await currentState(clientGpc));
    const [device, gpcHeader, account] = await Promise.all([readDeviceChoice(), readGpc(), getAccountPrivacy(supabase, user.id)]);
    const result = reconcileAnalyticsChoice({ device, account: account.analyticsChoice, gpc: gpcHeader || clientGpc });
    if (result.setAccount) await saveAccountPrivacy(supabase, user.id, { analyticsChoice: result.setAccount });
    if (result.setDevice) await writeDeviceChoice(result.setDevice);
    const state = await currentState(clientGpc);
    return NextResponse.json({ ...state, analytics: result.effective ?? state.analytics });
  }

  if (action === "set") {
    const analytics = body.analytics;
    const personalizedDiscovery = body.personalizedDiscovery;
    const marketingEmail = body.marketingEmail;
    if (analytics !== undefined && !isAnalyticsChoice(analytics)) return NextResponse.json({ error: "Invalid choice." }, { status: 400 });
    if (personalizedDiscovery !== undefined && typeof personalizedDiscovery !== "boolean") return NextResponse.json({ error: "Invalid choice." }, { status: 400 });
    if (marketingEmail !== undefined && typeof marketingEmail !== "boolean") return NextResponse.json({ error: "Invalid choice." }, { status: 400 });

    if (isAnalyticsChoice(analytics)) {
      const previous = await readDeviceChoice();
      // A new grant starts a fresh 90-day identifier rather than reviving
      // one minted before this policy (or before a refusal).
      if (analytics === "granted" && previous !== "granted") {
        const store = await cookies();
        store.delete(ANALYTICS_SESSION_COOKIE);
        store.delete(ANALYTICS_ACQUISITION_COOKIE);
      }
      await writeDeviceChoice(analytics);
    }
    if (user) {
      const patch: Partial<AccountPrivacy> = {};
      if (isAnalyticsChoice(analytics)) patch.analyticsChoice = analytics;
      if (typeof personalizedDiscovery === "boolean") patch.personalizedDiscovery = personalizedDiscovery;
      if (typeof marketingEmail === "boolean") patch.marketingEmail = marketingEmail;
      if (Object.keys(patch).length > 0) {
        const ok = await saveAccountPrivacy(supabase, user.id, patch);
        if (!ok) return NextResponse.json({ error: "Couldn't save your choices. Please try again." }, { status: 500 });
      }
    }
    const state = await currentState(clientGpc);
    return NextResponse.json({ ...state, analytics: isAnalyticsChoice(analytics) ? analytics : state.analytics });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
