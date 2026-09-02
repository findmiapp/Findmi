import Link from "next/link";
import {
  getAdminClaims,
  getCurrentAccessByEntity,
  type AdminCurrentAccessMember,
  type ClaimEntityType,
  type ClaimStatus,
} from "@/lib/admin/claim-queries";
import { RemoveOwnerForm, TransferOwnershipForm } from "@/components/admin/OwnershipActions";
import { approveClaim, rejectClaim, removeMember, removeOwner, transferOwnership, updateMemberRole } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_VIEWS: { value: ClaimStatus | undefined; label: string }[] = [
  { value: undefined, label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

const TYPE_VIEWS: { value: ClaimEntityType | undefined; label: string }[] = [
  { value: undefined, label: "All" },
  { value: "business", label: "Business" },
  { value: "event", label: "Event" },
];

function filterHref(status: ClaimStatus | undefined, type: ClaimEntityType | undefined, paidOnly: boolean): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (type) params.set("type", type);
  if (paidOnly) params.set("view", "paid_needs_review");
  const qs = params.toString();
  return qs ? `/admin/claims?${qs}` : "/admin/claims";
}

function formatAmount(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function AdminClaimsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    type?: string;
    view?: string;
    error?: string;
    approved?: string;
    rejected?: string;
    member_updated?: string;
  }>;
}) {
  const { status, type, view, error, approved, rejected, member_updated } = await searchParams;
  const activeStatus = STATUS_VIEWS.find((v) => v.value === status)?.value;
  const activeType = TYPE_VIEWS.find((v) => v.value === type)?.value;
  const paidOnly = view === "paid_needs_review";
  const claims = await getAdminClaims({
    status: paidOnly ? undefined : activeStatus,
    entityType: activeType,
    view: paidOnly ? "paid_needs_review" : undefined,
  });

  // Current Access — deliberately fetched independently of the claim
  // rows' own historical fields (see claim-queries.ts). Keyed by
  // "entityType-entityId" since business/event ids are both plain uuids
  // and could theoretically collide.
  const businessIds = Array.from(
    new Set(claims.filter((c) => c.entityType === "business").map((c) => c.entity?.id).filter((id): id is string => Boolean(id)))
  );
  const eventIds = Array.from(
    new Set(claims.filter((c) => c.entityType === "event").map((c) => c.entity?.id).filter((id): id is string => Boolean(id)))
  );
  const [businessMembers, eventMembers] = await Promise.all([
    getCurrentAccessByEntity("business", businessIds),
    getCurrentAccessByEntity("event", eventIds),
  ]);
  const currentAccessFor = (c: (typeof claims)[number]): AdminCurrentAccessMember[] => {
    if (!c.entity?.id) return [];
    const map = c.entityType === "business" ? businessMembers : eventMembers;
    return map.get(c.entity.id) ?? [];
  };

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Claims</h1>
      <p className="mt-1 text-sm text-ink/50">
        Requests from signed-in FindMi accounts to manage a business or event. A $20 listing activation payment is
        required before a claim can be approved — approving grants ownership, so review each claim carefully.
      </p>

      {error && (
        <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</p>
      )}
      {approved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Claim approved — membership granted.
        </p>
      )}
      {rejected && !error && (
        <p className="mt-3 rounded-xl border border-black/10 bg-black/[0.02] px-4 py-3 text-sm text-ink/70">
          Claim rejected.
        </p>
      )}
      {member_updated && !error && (
        <p className="mt-3 rounded-xl border border-black/10 bg-black/[0.02] px-4 py-3 text-sm text-ink/70">
          Current Access updated.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={filterHref(undefined, activeType, true)}
          className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
            paidOnly ? "bg-amber-500 text-white" : "border border-amber-300 text-amber-800 hover:border-amber-400"
          }`}
        >
          Paid — Needs Review
        </Link>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {STATUS_VIEWS.map((v) => (
          <Link
            key={v.label}
            href={filterHref(v.value, activeType, false)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              !paidOnly && activeStatus === v.value ? "bg-findmi text-white" : "border border-black/10 text-ink/60 hover:border-black/20"
            }`}
          >
            {v.label}
          </Link>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {TYPE_VIEWS.map((v) => (
          <Link
            key={v.label}
            href={filterHref(activeStatus, v.value, paidOnly)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              activeType === v.value ? "bg-ink text-white" : "border border-black/10 text-ink/60 hover:border-black/20"
            }`}
          >
            {v.label}
          </Link>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {claims.length === 0 && <p className="text-sm text-ink/50">No claims.</p>}

        {claims.map((c) => {
          const paidNeedsReview = c.status === "pending" && c.paymentStatus === "paid";
          return (
            <div
              key={`${c.entityType}-${c.id}`}
              className={`rounded-2xl border p-4 text-sm ${paidNeedsReview ? "border-amber-300 bg-amber-50/40" : "border-black/10"}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <span className="rounded-full bg-black/[0.06] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink/50">
                    {c.entityType}
                  </span>
                  <p className="mt-1 font-semibold text-ink">{c.entity?.name ?? "Unknown"}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {paidNeedsReview && (
                    <span className="rounded-full bg-amber-500 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
                      Paid — Needs Review
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                      c.status === "approved"
                        ? "bg-findmi-50 text-findmi-700"
                        : c.status === "rejected"
                          ? "bg-black/[0.06] text-ink/50"
                          : "bg-black/[0.06] text-ink/60"
                    }`}
                  >
                    {c.status}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                      c.paymentStatus === "paid"
                        ? "bg-findmi-50 text-findmi-700"
                        : c.paymentStatus === "refunded"
                          ? "bg-red-50 text-red-700"
                          : "border border-black/10 text-ink/50"
                    }`}
                  >
                    {c.paymentStatus}
                  </span>
                </div>
              </div>

              <div className="mt-2 grid gap-x-4 gap-y-1 text-ink/70 sm:grid-cols-2">
                <p>Claimant: {c.claimantDisplayName || "—"}</p>
                <p>Email: {c.claimantEmail || "—"}</p>
                <p>Phone: {c.claimantPhone || "—"}</p>
                <p>Amount paid: {formatAmount(c.paymentAmount)}</p>
                <p>Paid: {c.paidAt ? new Date(c.paidAt).toLocaleString("en-US") : "—"}</p>
                {/* Evidence upload doesn't exist yet — message is its own
                    optional field, never treated as evidence. Always "No"
                    until a real evidence-upload feature is built. */}
                <p>Evidence: No</p>
              </div>

              {c.message && <p className="mt-2 text-ink/60">&ldquo;{c.message}&rdquo;</p>}
              <p className="mt-2 text-xs text-ink/40">
                Submitted {new Date(c.created_at).toLocaleString("en-US")}
                {c.reviewed_at && ` · Reviewed ${new Date(c.reviewed_at).toLocaleString("en-US")}`}
              </p>

              {c.entityAlreadyOwned && c.status === "pending" && (
                <p className="mt-2 text-xs font-semibold text-amber-700">
                  This {c.entityType} already has an owner — approving will be blocked until that&rsquo;s resolved.
                </p>
              )}
              {c.status === "pending" && c.paymentStatus !== "paid" && (
                <p className="mt-2 text-xs font-semibold text-ink/50">
                  Awaiting the $20 claim payment — approving is blocked until payment is confirmed.
                </p>
              )}

              {c.status === "pending" && (
                <div className="mt-3 flex gap-2">
                  <form action={approveClaim.bind(null, c.entityType, c.id)}>
                    <button
                      type="submit"
                      disabled={c.paymentStatus !== "paid"}
                      title={c.paymentStatus !== "paid" ? "Claim hasn't been paid yet" : undefined}
                      className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-black/[0.03] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      Approve
                    </button>
                  </form>
                  <form action={rejectClaim.bind(null, c.entityType, c.id)}>
                    <button
                      type="submit"
                      className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-black/[0.03]"
                    >
                      Reject
                    </button>
                  </form>
                </div>
              )}

              {/* Current Access — CURRENT membership (business_members/
                  event_members), deliberately separate from the claim
                  record above: this is never edited by touching the
                  claim, and the claim's own historical fields are never
                  edited from here. */}
              <div className="mt-3 border-t border-black/10 pt-3">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink/40">Current Access</p>
                {(() => {
                  const members = currentAccessFor(c);
                  if (members.length === 0) {
                    return <p className="text-xs text-ink/40">No current members.</p>;
                  }
                  const entityId = c.entity?.id ?? "";
                  const hasOwner = members.some((m) => m.role === "owner");
                  const eligibleTargets = members
                    .filter((m): m is AdminCurrentAccessMember & { role: "manager" | "staff" } => m.role !== "owner")
                    .map((m) => ({ id: m.id, label: m.displayName || m.email || "Member", role: m.role }));
                  return (
                    <div className="flex flex-col gap-2">
                      {!hasOwner && (
                        <p className="text-[11px] font-semibold text-amber-700">No owner currently assigned.</p>
                      )}
                      {members.map((m) => (
                        <div
                          key={m.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-black/[0.02] px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-ink">
                              {m.displayName || m.email || "Member"}
                            </p>
                            {m.displayName && m.email && (
                              <p className="truncate text-[11px] text-ink/45">{m.email}</p>
                            )}
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                                m.role === "owner" ? "bg-findmi text-white" : "bg-black/[0.06] text-ink/60"
                              }`}
                            >
                              {m.role}
                            </span>
                            {m.role === "owner" ? (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <TransferOwnershipForm
                                  action={transferOwnership.bind(null, c.entityType, entityId)}
                                  eligibleMembers={eligibleTargets}
                                />
                                <RemoveOwnerForm
                                  action={removeOwner.bind(null, c.entityType, entityId)}
                                  ownerLabel={m.displayName || m.email || "the current owner"}
                                />
                              </div>
                            ) : (
                              <>
                                <form
                                  action={updateMemberRole.bind(
                                    null,
                                    c.entityType,
                                    m.id,
                                    m.role === "manager" ? "staff" : "manager"
                                  )}
                                >
                                  <button
                                    type="submit"
                                    className="rounded-lg border border-black/10 px-2 py-1 text-[11px] font-semibold text-ink transition hover:bg-black/[0.03]"
                                  >
                                    Make {m.role === "manager" ? "Staff" : "Manager"}
                                  </button>
                                </form>
                                <form action={removeMember.bind(null, c.entityType, m.id)}>
                                  <button
                                    type="submit"
                                    className="rounded-lg border border-black/10 px-2 py-1 text-[11px] font-semibold text-red-600 transition hover:bg-red-50"
                                  >
                                    Remove
                                  </button>
                                </form>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
