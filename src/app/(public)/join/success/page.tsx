import type { Metadata } from "next";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { resolveOnboardingForm } from "@/lib/forms";
import MembershipConfirmation from "./MembershipConfirmation";
import { SuccessPanel, UnverifiedPanel } from "./panels";

export const metadata: Metadata = {
  title: "Welcome to FindMi",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

export default async function JoinSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ membership_id?: string }>;
}) {
  const { membership_id } = await searchParams;
  if (!membership_id) return <UnverifiedPanel />;

  const supabase = getAdminSupabase();
  const { data: membership } = supabase
    ? await supabase
        .from("memberships")
        .select("id, billing_status, existing_business_id, plan:membership_plans(slug)")
        .eq("id", membership_id)
        .maybeSingle()
    : { data: null };
  if (!membership) return <UnverifiedPanel />;

  // Only ever build the plan-aware, membership-linked onboarding link once
  // Stripe's webhook has actually confirmed payment (billing_status flips
  // paid there, never trusted from the client/URL alone) — see
  // lib/commerce/membershipActivation.ts.
  if (membership.billing_status === "paid") {
    const plan = Array.isArray(membership.plan) ? membership.plan[0] : membership.plan;
    const onboardingForm = await resolveOnboardingForm(
      {
        id: membership.id,
        source: "paid",
        planSlug: plan?.slug ?? null,
        existingBusinessId: membership.existing_business_id,
      },
      "ssr"
    );
    // display_mode trace, last server-side checkpoint: the exact value
    // about to be handed to <SuccessPanel> as the `onboarding.displayMode`
    // prop — from here it crosses into client-rendered JSX (OnboardingCta),
    // which is not independently server-loggable.
    console.log("[join/success page.tsx]", {
      context: "ssr",
      passedDisplayMode: onboardingForm?.displayMode ?? null,
    });
    return (
      <SuccessPanel
        onboarding={onboardingForm ? { url: onboardingForm.url, displayMode: onboardingForm.displayMode } : null}
      />
    );
  }

  // Stripe's redirect can land here before the checkout.session.completed
  // webhook has processed — never claim "membership active" until
  // billing_status is actually "paid" server-side. Hand off to a bounded
  // client-side poll instead of guessing or blocking on the webhook here.
  return <MembershipConfirmation membershipId={membership.id} />;
}
