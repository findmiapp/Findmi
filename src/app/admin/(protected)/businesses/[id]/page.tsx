import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminBusinessById, getAllCategories } from "@/lib/admin/queries";
import {
  billingStatusLabel,
  getMembershipForBusiness,
  onboardingStatusLabel,
  publicationStatusLabel,
} from "@/lib/admin/membership-queries";
import ViewPublicPageLink from "@/components/admin/ViewPublicPageLink";
import BusinessForm from "../BusinessForm";
import { getCurrentAccessByEntity } from "@/lib/admin/claim-queries";
import { assignBusinessMember, removeBusinessMember } from "../actions";

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
  const [result, categories, membership, accessByEntity] = await Promise.all([
    getAdminBusinessById(id),
    getAllCategories("business"),
    getMembershipForBusiness(id),
    // Owner/manager/staff access — a DIFFERENT thing from the Founding
    // Membership billing block below (same "Membership" word, unrelated
    // systems). Same id -> email lookup pattern the claims page's Current
    // Access section already uses (fetchEmailsByUserId under the hood).
    getCurrentAccessByEntity("business", [id]),
  ]);
  if (!result) notFound();
  const { business } = result;
  const publicHref = !business.is_demo && business.publication_status === "live" ? `/business/${business.slug}` : null;
  const members = accessByEntity.get(id) ?? [];
  const assignMember = assignBusinessMember.bind(null, id);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          Edit Business
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/admin/appearances?business=${business.id}`}
            className="text-xs font-semibold text-ink/60 hover:text-ink"
          >
            View Appearances
          </Link>
          <Link
            href={`/admin/appearances/import?business=${business.id}`}
            className="text-xs font-semibold text-ink/60 hover:text-ink"
          >
            Import Appearances
          </Link>
          <ViewPublicPageLink href={publicHref} />
        </div>
      </div>
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

      {/* Business Members — owner/manager/staff access (business_members),
          a different system from the Founding Membership billing block
          above despite the similar name. Assignment/removal are new,
          page-scoped actions (see ../actions.ts) that reuse the same
          business_members table and never-touch-the-owner-row guard the
          claims page's own membership actions already use, just
          redirecting back here instead of to /admin/claims. */}
      <div className="mt-5 rounded-2xl border border-black/10 bg-mist/40 p-4">
        <p className="text-sm font-semibold text-ink">Business Members</p>
        <p className="mt-1 text-xs text-ink/45">
          Grants management access to an existing FindMi account (Manage Business, this business&rsquo;s own editor).
          Doesn&rsquo;t create accounts or change ownership — see Claims for that.
        </p>

        {members.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2">
            {members.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-black/10 bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{m.email ?? m.displayName ?? "Unknown account"}</p>
                  <p className="text-xs uppercase tracking-wide text-ink/45">{m.role}</p>
                </div>
                {m.role !== "owner" && (
                  <form action={removeBusinessMember.bind(null, id, m.id)}>
                    <button type="submit" className="text-xs font-semibold text-red-600 hover:underline">
                      Remove
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-ink/50">No assigned members yet.</p>
        )}

        <form action={assignMember} className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="email"
            name="email"
            required
            placeholder="user@example.com"
            className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          >
            Assign
          </button>
        </form>
      </div>

      <div className="mt-5">
        <BusinessForm
          business={result.business}
          categories={categories}
          selectedCategoryIds={result.categoryIds}
          galleryImages={result.galleryImages}
          people={result.people}
          error={error}
        />
      </div>
    </div>
  );
}
