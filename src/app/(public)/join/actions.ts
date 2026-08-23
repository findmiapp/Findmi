"use server";

import { redirect } from "next/navigation";
import { createMembershipCheckoutSession } from "@/lib/commerce/membershipCheckout";

export async function startMembershipCheckout(formData: FormData) {
  const planSlug = String(formData.get("plan_slug") ?? "");
  const marketIds = formData.getAll("market_ids").map(String);
  const businessName = String(formData.get("business_name") ?? "");
  const contactName = String(formData.get("contact_name") ?? "");
  const contactEmail = String(formData.get("contact_email") ?? "");

  const result = await createMembershipCheckoutSession({
    planSlug,
    marketIds,
    businessName,
    contactName,
    contactEmail,
  });

  if ("error" in result) {
    redirect(`/join?error=${encodeURIComponent(result.error)}&plan=${encodeURIComponent(planSlug)}`);
  }
  redirect(result.url);
}
