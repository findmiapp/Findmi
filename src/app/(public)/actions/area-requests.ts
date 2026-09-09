"use server";

import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { findOrCreateConsumerMarketRequest, recordMarketRequestInterest } from "@/lib/market-requests";
import { notifyAdmin } from "@/lib/notifications/adminNotify";

// Consumer Area Picker + Market Requests V1 — the one public entry point
// for "Don't see your area? / Notify me when this Area launches",
// called directly (not via a <form action>) from the client AreaPicker
// component on the homepage/businesses/events. Validated server-side —
// never trusts client-supplied identity: the real signed-in user (if
// any) is re-derived here from the request's own cookies, exactly like
// every other account-aware Server Action in this codebase, never taken
// from a client-passed field.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TEXT_LENGTH = 120;

export interface RequestMissingAreaResult {
  ok: boolean;
  error?: string;
  /** Set when the typed text matched an Area/Market that already exists
   * internally (see findExistingGeographyMatch) — the request was still
   * recorded (for interest tracking / a future notification pass), but
   * no NEW pending review was created and no duplicate geography risk
   * exists. The client uses this to show an honest message instead of
   * the generic "you're on the list". */
  matchedLabel?: string;
}

export async function requestMissingArea(input: { text: string; email?: string }): Promise<RequestMissingAreaResult> {
  const text = (input.text ?? "").trim().slice(0, MAX_TEXT_LENGTH);
  if (text.length < 2) return { ok: false, error: "Enter a city or area." };

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Signed-out: an email is required so there's a real way to notify
  // this person later — never forced account creation, just one field.
  let email: string | null = null;
  if (!user) {
    email = (input.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email address." };
  }

  const admin = getAdminSupabase();
  if (!admin) return { ok: false, error: "Server isn't configured." };

  try {
    const { requestId, match, created } = await findOrCreateConsumerMarketRequest(admin, { text });
    await recordMarketRequestInterest(admin, { requestId, userId: user?.id ?? null, email });
    // Admin Action Email Notifications V1 — only a genuinely new,
    // still-`pending` request needs founder attention; `created: false`
    // means this reused an already-recorded request (interest was just
    // added to it, no new review needed), and a non-null `match` means
    // it auto-resolved onto existing geography (status='mapped') rather
    // than landing in the review queue at all.
    if (created && !match) {
      await notifyAdmin({
        subject: `New Market/Area request — ${text}`,
        heading: "New Market/Area request",
        body: [`Requested: ${text}`, "Source: Consumer (Area Picker)"],
        actionLabel: "Review Market Requests",
        actionUrl: "/admin/market-requests",
      });
    }
    return { ok: true, matchedLabel: match?.label };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't submit your request." };
  }
}
