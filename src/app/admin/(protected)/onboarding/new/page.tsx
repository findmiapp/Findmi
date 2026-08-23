import { getAllMarkets, getAllMembershipPlans } from "@/lib/admin/membership-queries";
import { createInviteMembership } from "../actions";
import InviteForm from "./InviteForm";

export const dynamic = "force-dynamic";

export default async function NewInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const [plans, markets] = await Promise.all([getAllMembershipPlans(), getAllMarkets()]);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
        Invite a Vendor
      </h1>
      <p className="mt-1 text-sm text-ink/50">
        Creates a comped, pending membership and a private intake link — no payment required.
      </p>
      {error && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="mt-5">
        <InviteForm plans={plans} markets={markets} action={createInviteMembership} />
      </div>
    </div>
  );
}
