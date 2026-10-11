"use server";

import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { analyzeBrandWebsite, defaultWebsiteAnalysisDeps, manualBrandFormHref } from "@/lib/brand-website-analysis";
import { websiteAnalysisClientIp } from "@/lib/brand-website-rate-limit";

const WEBSITE_INPUT_MAX = 200;

/** Brand Onboarding V1.1B — "Build My Brand Profile" (explicit POST from
 * /join/brand's website no-match state). Signed-in only: an anonymous
 * caller is sent to sign in and back to the same no-match result. All
 * work happens in lib/brand-website-analysis.ts; this action only reads
 * the session and redirects to the result (claim, assistance, or the
 * existing /account/business/new form — prefilled, or manual). */
export async function buildBrandProfile(formData: FormData) {
  const raw = formData.get("website");
  const website = typeof raw === "string" ? raw.slice(0, WEBSITE_INPUT_MAX) : "";
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const deps = defaultWebsiteAnalysisDeps();
  // Server not configured → the manual form (still behind sign-in).
  if (!deps) redirect(manualBrandFormHref(website));
  const ip = await websiteAnalysisClientIp();
  const { href } = await analyzeBrandWebsite({ website, userId: user?.id ?? null, ip }, deps);
  redirect(href);
}
