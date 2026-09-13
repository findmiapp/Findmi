"use server";

import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { errorRedirectUrlWithFields, num, str } from "@/lib/admin/form-helpers";
import { sendOperationalNotification } from "@/lib/notifications/send";

// Multi-Region / National Sales Inquiry pass — the one public entry
// point for /join's "Talk to Sales" flow (join/sales/page.tsx's form).
// Anonymous — no signed-in account required, same as
// (public)/actions/area-requests.ts's requestMissingArea, which this
// mirrors: getAdminSupabase() (service-role) is used directly for the
// write, since sales_inquiries has RLS enabled with no public policies
// (see that table's own migration note) — never the anon/auth client.
const FORM_PATH = "/join/sales";
const SUCCESS_PATH = "/join/sales?submitted=1";

// Findmiapp@gmail.com is the authoritative recipient for this lead —
// deliberately NOT routed through notifyAdmin() (lib/notifications/
// adminNotify.ts), which hardcodes the general ADMIN_NOTIFICATION_EMAILS
// list and has no way to target a specific address. This inquiry always
// goes to Findmi's actual sales inbox regardless of whatever that env
// var happens to be configured to.
const SALES_INQUIRY_RECIPIENT = "Findmiapp@gmail.com";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 120;
const MAX_BUSINESS_LENGTH = 160;
const MAX_SHORT_LENGTH = 200;
const MAX_REGIONS_LENGTH = 300;
const MAX_GOALS_LENGTH = 2000;
const MAX_CITY_MARKET_COUNT = 100000;

/** Same non-throwing, log-and-continue shape as notifyAdmin() — a failed
 * send here must never lose the inquiry (already persisted before this
 * is ever called) or surface a provider error to the prospect. Not
 * reusing notifyAdmin() itself only because it can't take an explicit
 * `to` — see this file's own SALES_INQUIRY_RECIPIENT note. */
async function notifySalesInbox(inquiryId: string, subject: string, body: string[]): Promise<void> {
  try {
    await sendOperationalNotification({
      to: [SALES_INQUIRY_RECIPIENT],
      subject,
      heading: subject,
      body,
      footerLabel: "Findmi Sales Inquiry",
      footerNote: "Submitted via /join — Multi-Region / National.",
    });
  } catch (err) {
    // The inquiry row already exists — a notification failure here is
    // logged, never rethrown, and never makes the prospect resubmit.
    console.error(`[sales-inquiries] notification failed for inquiry ${inquiryId}`, err);
  }
}

function fieldsForRetry(fd: FormData): Record<string, string | null> {
  return {
    contact_name: str(fd, "contact_name"),
    business_name: str(fd, "business_name"),
    email: str(fd, "email"),
    phone: str(fd, "phone"),
    website_or_instagram: str(fd, "website_or_instagram"),
    city_market_count: str(fd, "city_market_count"),
    regions: str(fd, "regions"),
    goals: str(fd, "goals"),
  };
}

export async function submitSalesInquiry(formData: FormData) {
  // Honeypot — a real visitor never sees or fills this field (see
  // page.tsx's own note on why it's hidden, not just visually
  // collapsed). A filled value is treated as spam: redirect straight to
  // the normal success state without persisting anything or emailing
  // anyone, so a bot gets no signal that it was caught.
  if (str(formData, "company_site")) {
    redirect(SUCCESS_PATH);
  }

  const contactName = str(formData, "contact_name")?.slice(0, MAX_NAME_LENGTH) ?? null;
  const businessName = str(formData, "business_name")?.slice(0, MAX_BUSINESS_LENGTH) ?? null;
  const emailRaw = str(formData, "email");
  const email = emailRaw ? emailRaw.toLowerCase().slice(0, MAX_SHORT_LENGTH) : null;
  const phone = str(formData, "phone")?.slice(0, 40) ?? null;
  const websiteOrInstagram = str(formData, "website_or_instagram")?.slice(0, MAX_SHORT_LENGTH) ?? null;
  const cityMarketCountRaw = num(formData, "city_market_count");
  const regions = str(formData, "regions")?.slice(0, MAX_REGIONS_LENGTH) ?? null;
  const goals = str(formData, "goals")?.slice(0, MAX_GOALS_LENGTH) ?? null;

  const retryFields = fieldsForRetry(formData);
  const fail = (message: string) => redirect(errorRedirectUrlWithFields(FORM_PATH, message, retryFields));

  if (!contactName) fail("Enter your name.");
  if (!businessName) fail("Enter your business or brand name.");
  if (!email || !EMAIL_RE.test(email)) fail("Enter a valid email address.");
  if (!regions) fail("Tell us the regions or areas you serve or want to reach.");
  if (!goals) fail("Tell us what you're looking to accomplish.");
  if (cityMarketCountRaw === null || !Number.isInteger(cityMarketCountRaw) || cityMarketCountRaw < 1) {
    fail("Enter the number of cities or markets you currently serve.");
  }
  const cityMarketCount = Math.min(cityMarketCountRaw as number, MAX_CITY_MARKET_COUNT);

  const admin = getAdminSupabase();
  if (!admin) fail("Server isn't configured. Please try again shortly.");

  // Duplicate-tap guard — beyond the client-side disabled-on-submit
  // button (see SubmitButton.tsx), a resubmitted/replayed form from the
  // exact same prospect within a short window reuses the existing row
  // rather than creating a second one, so a flaky connection retry or a
  // slow back-button double-tap never produces duplicate sales leads.
  const dedupeWindowStart = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: recent } = await admin!
    .from("sales_inquiries")
    .select("id")
    .eq("email", email!)
    .eq("business_name", businessName!)
    .gte("created_at", dedupeWindowStart)
    .limit(1)
    .maybeSingle();

  if (recent) {
    redirect(SUCCESS_PATH);
  }

  const { data: inserted, error } = await admin!
    .from("sales_inquiries")
    .insert({
      contact_name: contactName,
      business_name: businessName,
      email,
      phone,
      website_or_instagram: websiteOrInstagram,
      city_market_count: cityMarketCount,
      regions,
      goals,
      source: "join_multi_region",
      status: "new",
    })
    .select("id")
    .single();

  if (error || !inserted) {
    fail("Couldn't submit your inquiry. Please try again.");
    return;
  }

  // Notification is best-effort and strictly AFTER the row is durably
  // persisted — see notifySalesInbox's own note. Its outcome never
  // changes what the prospect sees next.
  await notifySalesInbox(inserted.id as string, `New Findmi Multi-Region Sales Inquiry — ${businessName}`, [
    `Contact: ${contactName}`,
    `Business / brand: ${businessName}`,
    `Email: ${email}`,
    `Phone: ${phone ?? "—"}`,
    `Website / Instagram: ${websiteOrInstagram ?? "—"}`,
    `Cities / markets currently served: ${cityMarketCount}`,
    `Regions / areas served or interested in: ${regions}`,
    `Goals: ${goals}`,
    "Source: /join — Multi-Region / National",
  ]);

  redirect(SUCCESS_PATH);
}
