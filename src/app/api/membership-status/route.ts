import { NextResponse, type NextRequest } from "next/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { resolveOnboardingForm } from "@/lib/forms";

export const dynamic = "force-dynamic";

/**
 * Polled by /join/success's MembershipConfirmation while a just-completed
 * Stripe Checkout redirect has beaten the checkout.session.completed
 * webhook back to the browser (see lib/commerce/membershipActivation.ts —
 * that webhook path stays the sole thing that flips billing_status to
 * "paid"; this route only reads it). Read-only, no PII in the response —
 * just enough for the client to know whether to keep waiting, show
 * success, or give up on an unknown id.
 */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ status: "not_found" });

  const supabase = getAdminSupabase();
  if (!supabase) return NextResponse.json({ status: "pending" }); // fail soft — keep polling, never claim failure

  const { data: membership } = await supabase
    .from("memberships")
    .select("id, billing_status, existing_business_id, plan:membership_plans(slug)")
    .eq("id", id)
    .maybeSingle();

  if (!membership) return NextResponse.json({ status: "not_found" });
  if (membership.billing_status !== "paid") return NextResponse.json({ status: "pending" });

  const plan = Array.isArray(membership.plan) ? membership.plan[0] : membership.plan;
  const onboarding = await resolveOnboardingForm(
    {
      id: membership.id,
      source: "paid",
      planSlug: plan?.slug ?? null,
      existingBusinessId: membership.existing_business_id,
    },
    "poll"
  );

  return NextResponse.json({
    status: "paid",
    onboarding: onboarding ? { url: onboarding.url, displayMode: onboarding.displayMode } : null,
  });
}
