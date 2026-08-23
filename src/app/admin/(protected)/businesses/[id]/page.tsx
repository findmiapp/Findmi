import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminBusinessById, getAllCategories } from "@/lib/admin/queries";
import {
  billingStatusLabel,
  getMembershipForBusiness,
  onboardingStatusLabel,
  publicationStatusLabel,
} from "@/lib/admin/membership-queries";
import BusinessForm from "../BusinessForm";

export const dynamic = "force-dynamic";

export default async function EditBusinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { error, saved } = await searchParams;
  const [result, categories, membership] = await Promise.all([
    getAdminBusinessById(id),
    getAllCategories(),
    getMembershipForBusiness(id),
  ]);
  if (!result) notFound();

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
        Edit Business
      </h1>
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved.
        </p>
      )}

      <div className="mt-5 rounded-2xl border border-black/10 bg-mist/40 p-4">
        <p className="text-sm font-semibold text-ink">Membership</p>
        {membership ? (
          <div className="mt-2 flex flex-col gap-1.5 text-sm text-ink/70">
            <p>
              Plan: <span className="font-medium text-ink">{membership.plan?.name ?? "—"}</span>
              {membership.founding_price_locked && (
                <span className="ml-1.5 text-xs font-semibold text-findmi-700">(founding price locked)</span>
              )}
            </p>
            <p>
              Markets:{" "}
              <span className="font-medium text-ink">
                {membership.markets.length ? membership.markets.map((m) => m.name).join(", ") : "None assigned"}
              </span>
            </p>
            <p>
              Billing: <span className="font-medium text-ink">{billingStatusLabel(membership.billing_status)}</span>
              {" · "}Onboarding: <span className="font-medium text-ink">{onboardingStatusLabel(membership.onboarding_status)}</span>
              {" · "}Publication: <span className="font-medium text-ink">{publicationStatusLabel(membership.publication_status)}</span>
            </p>
            {membership.stripe_customer_id && (
              <p className="text-xs text-ink/45">Stripe customer: {membership.stripe_customer_id}</p>
            )}
            <Link
              href={`/admin/onboarding/${membership.id}`}
              className="mt-1 inline-block text-xs font-semibold text-findmi-700 hover:underline"
            >
              Manage membership →
            </Link>
          </div>
        ) : (
          <p className="mt-1.5 text-sm text-ink/50">
            No membership record — this business isn&rsquo;t linked to a membership/onboarding entry.
          </p>
        )}
      </div>

      <div className="mt-5">
        <BusinessForm
          business={result.business}
          categories={categories}
          selectedCategoryIds={result.categoryIds}
          error={error}
        />
      </div>
    </div>
  );
}
