import { notFound } from "next/navigation";
import Link from "next/link";
import {
  billingStatusLabel,
  getAdminMembershipById,
  getAllMarkets,
  getAllMembershipPlans,
  getBusinessOptionByIdForMembership,
  getMarketIdsForMembership,
  onboardingStatusLabel,
  publicationStatusLabel,
} from "@/lib/admin/membership-queries";
import { getOnboardingFormUrl } from "@/lib/tally";
import MembershipEditForm from "./MembershipEditForm";
import { approveMembership, markComped, pauseMembership, rejectMembership, updateMembership } from "../actions";

export const dynamic = "force-dynamic";

export default async function MembershipDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; invited?: string }>;
}) {
  const { id } = await params;
  const { error, saved, invited } = await searchParams;

  const membership = await getAdminMembershipById(id);
  if (!membership) notFound();

  const [plans, markets, selectedMarketIds, existingBusinessOption] = await Promise.all([
    getAllMembershipPlans(),
    getAllMarkets(),
    getMarketIdsForMembership(id),
    getBusinessOptionByIdForMembership(membership.existing_business_id),
  ]);

  const inviteUrl =
    membership.billing_status === "comped"
      ? getOnboardingFormUrl({
          id: membership.id,
          source: "invited",
          planSlug: membership.plan?.slug,
          existingBusinessId: membership.existing_business_id,
        })
      : null;

  const updateAction = updateMembership.bind(null, id);
  const approveAction = approveMembership.bind(null, id);
  const rejectAction = rejectMembership.bind(null, id);
  const pauseAction = pauseMembership.bind(null, id);
  const compAction = markComped.bind(null, id);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          {membership.business?.name ?? membership.intended_business_name ?? "Onboarding"}
        </h1>
        <Link href="/admin/onboarding" className="text-xs font-semibold text-ink/50 hover:text-ink">
          ← All Onboarding
        </Link>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge>{billingStatusLabel(membership.billing_status)}</Badge>
        <Badge>{onboardingStatusLabel(membership.onboarding_status)}</Badge>
        <Badge tone={membership.publication_status === "live" ? "live" : membership.publication_status === "rejected" ? "rejected" : "default"}>
          {publicationStatusLabel(membership.publication_status)}
        </Badge>
      </div>

      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved.
        </p>
      )}
      {invited && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Invite created. Send the vendor the intake link below.
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {inviteUrl && (
        <div className="mt-4 rounded-2xl border border-black/10 bg-mist/40 p-4">
          <p className="text-sm font-semibold text-ink">Private intake link</p>
          <p className="mt-1 break-all text-xs text-findmi-700">{inviteUrl}</p>
          <p className="mt-1 text-xs text-ink/45">
            Send this to the vendor. Their submission enters as pending review automatically.
          </p>
        </div>
      )}

      {membership.business ? (
        <p className="mt-4 text-sm text-ink/60">
          Linked business:{" "}
          <Link href={`/admin/businesses/${membership.business.id}`} className="font-semibold text-findmi-700 hover:underline">
            {membership.business.name}
          </Link>
        </p>
      ) : (
        <p className="mt-4 text-sm text-ink/50">
          No business linked yet — created automatically once the intake form is submitted, or linkable below.
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <form action={approveAction}>
          <button
            type="submit"
            className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink hover:bg-findmi-600"
          >
            Approve — Go Live
          </button>
        </form>
        <form action={pauseAction}>
          <button
            type="submit"
            className="rounded-full border border-black/10 px-4 py-2 text-xs font-semibold text-ink hover:bg-black/[0.03]"
          >
            Pause
          </button>
        </form>
        <form action={rejectAction}>
          <button
            type="submit"
            className="rounded-full border border-red-200 px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
          >
            Reject
          </button>
        </form>
        {membership.billing_status !== "comped" && (
          <form action={compAction}>
            <button
              type="submit"
              className="rounded-full border border-black/10 px-4 py-2 text-xs font-semibold text-ink hover:bg-black/[0.03]"
            >
              Mark Comped
            </button>
          </form>
        )}
      </div>

      <div className="mt-6">
        <MembershipEditForm
          membership={membership}
          plans={plans}
          markets={markets}
          selectedMarketIds={selectedMarketIds}
          existingBusinessOption={existingBusinessOption}
          action={updateAction}
        />
      </div>
    </div>
  );
}

function Badge({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "live" | "rejected" }) {
  const cls =
    tone === "live"
      ? "bg-findmi-50 text-findmi-700"
      : tone === "rejected"
        ? "bg-red-50 text-red-700"
        : "bg-black/[0.06] text-ink/60";
  return <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${cls}`}>{children}</span>;
}
