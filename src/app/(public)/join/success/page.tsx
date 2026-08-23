import type { Metadata } from "next";
import Link from "next/link";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getOnboardingFormUrl } from "@/lib/tally";

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

  let onboardingUrl = getOnboardingFormUrl();
  if (membership_id) {
    const supabase = getAdminSupabase();
    if (supabase) {
      const { data: membership } = await supabase
        .from("memberships")
        .select("id, billing_status, existing_business_id, plan:membership_plans(slug)")
        .eq("id", membership_id)
        .maybeSingle();
      // Only build the plan-aware, membership-linked onboarding link once
      // Stripe's webhook has actually confirmed payment (billing_status
      // flips paid there, never trusted from the client/URL alone) — until
      // then this quietly falls back to the generic onboarding link below.
      if (membership && membership.billing_status === "paid") {
        const plan = Array.isArray(membership.plan) ? membership.plan[0] : membership.plan;
        onboardingUrl = getOnboardingFormUrl({
          id: membership.id,
          source: "paid",
          planSlug: plan?.slug ?? null,
          existingBusinessId: membership.existing_business_id,
        });
      }
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-start px-6 py-20 sm:py-28">
      <span className="inline-flex items-center gap-1 rounded-full bg-findmi px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
        Payment confirmed
      </span>
      <h1 className="mt-5 font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">
        Welcome to FindMi.
      </h1>
      <p className="mt-4 max-w-md text-lg text-ink/60">
        Your membership is active. Now let&rsquo;s build your profile.
      </p>

      {onboardingUrl ? (
        <a
          href={onboardingUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-8 rounded-full bg-findmi px-6 py-3.5 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Build My Profile
        </a>
      ) : (
        <p className="mt-8 text-sm text-ink/50">
          Onboarding form coming shortly — we&rsquo;ll be in touch by email.
        </p>
      )}

      <p className="mt-10 text-sm text-ink/50">
        Questions in the meantime?{" "}
        <Link href="/about" className="font-medium text-ink underline underline-offset-2">
          Learn more about FindMi
        </Link>
        .
      </p>
    </div>
  );
}
