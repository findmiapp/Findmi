import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { errorRedirectUrl } from "@/lib/admin/form-helpers";
import { requireBusinessMember } from "@/lib/permissions";
import { isBusinessPro } from "@/lib/entitlements";
import { getLatestProAccessRequest } from "@/lib/pro-access-requests";
import { requestProAccess } from "../../pro-access-actions";
import ChevronIcon from "@/components/ChevronIcon";

export const dynamic = "force-dynamic";

/** Pro Access Request Workflow V1 — the real owner-facing destination for
 * requesting Findmi Pro without paying. Deliberately a standalone route
 * (not wired into the existing Business Manager tabs/UpgradeLockedTab/
 * Plan & Status CTAs yet — see this pass's own scope note): this pass
 * proves the destination works end-to-end before a later pass repoints
 * any existing "Upgrade to Pro" CTA at it. Never shows a price, never
 * collects payment, never implies approval is guaranteed, never implies
 * the business can't keep using Findmi while it waits. */
export default async function BusinessProRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ submitted?: string; error?: string }>;
}) {
  const { id } = await params;
  const { submitted, error } = await searchParams;

  try {
    await requireBusinessMember(id);
  } catch (err) {
    redirect(errorRedirectUrl("/account", err instanceof Error ? err.message : "You don't have access to this business."));
  }

  const admin = getAdminSupabase();
  if (!admin) redirect(errorRedirectUrl("/account", "Server isn't configured."));

  const { data: business } = await admin
    .from("businesses")
    .select("id, name, plan_tier, plan_expires_at")
    .eq("id", id)
    .maybeSingle();
  if (!business) redirect(errorRedirectUrl("/account", "Business not found."));

  const pro = isBusinessPro(business);
  const latestRequest = await getLatestProAccessRequest(admin, id);
  const hasPendingRequest = latestRequest?.status === "pending";

  const basePath = `/account/business/${id}`;

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-6">
      <Link href={basePath} className="flex w-fit items-center gap-1 text-metadata font-semibold text-muted hover:text-secondary">
        <ChevronIcon direction="left" className="h-3 w-3" />
        Back
      </Link>

      <div>
        <h1 className="font-display text-page-title font-bold text-primary">Request Pro Access</h1>
        <p className="mt-1 text-body text-muted">For {business.name}.</p>
      </div>

      {error && <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-body text-amber-800">{error}</p>}

      {pro ? (
        <div className="rounded-2xl border border-black/[0.07] bg-white p-4">
          <p className="text-body text-secondary">{business.name} already has Findmi Pro active.</p>
          <Link href={`${basePath}?tab=settings`} className="mt-2 inline-flex items-center gap-1 text-metadata font-bold text-accent">
            View Plan & Status
            <ChevronIcon direction="right" className="h-3 w-3" />
          </Link>
        </div>
      ) : hasPendingRequest ? (
        <div className="rounded-2xl border border-black/[0.07] bg-white p-4">
          <p className="text-body font-semibold text-primary">Request received.</p>
          <p className="mt-1 text-body text-muted">
            We&rsquo;re reviewing your request to enable Findmi Pro for {business.name}. You can keep using every Free
            Findmi tool while you wait — nothing about your current access changes.
          </p>
          <p className="mt-2 text-metadata text-subtle">Submitted {new Date(latestRequest.createdAt).toLocaleDateString("en-US")}.</p>
        </div>
      ) : (
        <>
          {submitted && (
            <p className="rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-body text-accent">
              Request received. We&rsquo;ll follow up once it&rsquo;s been reviewed.
            </p>
          )}
          {latestRequest && latestRequest.status === "declined" && (
            <p className="rounded-xl border border-black/10 bg-black/[0.02] px-4 py-3 text-body text-muted">
              Your previous request wasn&rsquo;t approved. You&rsquo;re welcome to submit a new one below.
            </p>
          )}
          <form action={requestProAccess.bind(null, id)} className="flex flex-col gap-3 rounded-2xl border border-black/[0.07] bg-white p-4">
            <p className="text-body text-secondary">
              Tell Findmi why you&rsquo;d like Pro access. A real person reviews every request — this doesn&rsquo;t
              guarantee approval, and you can keep using Findmi&rsquo;s Free tools either way.
            </p>
            <label className="flex flex-col gap-1">
              <span className="text-metadata font-semibold text-muted">What would you use Pro for? (optional)</span>
              <textarea
                name="message"
                rows={3}
                maxLength={2000}
                className="rounded-xl border border-black/10 px-3 py-2 text-body"
                placeholder="e.g. We want to see Performance analytics for our upcoming pop-ups."
              />
            </label>
            <button
              type="submit"
              className="flex h-11 w-full items-center justify-center rounded-2xl bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
            >
              Request Pro Access
            </button>
          </form>
        </>
      )}
    </div>
  );
}
