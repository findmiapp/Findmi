"use client";

// Claim Membership Management pass — ownership itself only ever moves
// through the reviewed transfer_business_ownership()/
// transfer_event_ownership()/remove_business_owner()/remove_event_owner()
// RPCs (see supabase/migrations/20260902020000_ownership_transfer_rpcs.sql).
// These two components are pure presentation + a client-side confirmation
// gate — no ownership logic lives here; both simply submit a plain form to
// the Server Action bound to them, which is the only thing that ever calls
// an RPC. Kept as small, targeted client components (not a rewrite of the
// claims page) purely because window.confirm() needs to run in the
// browser before a submit is allowed through.

interface EligibleTarget {
  /** business_members/event_members ROW ID — never a user id. */
  id: string;
  label: string;
  role: "manager" | "staff";
}

export function TransferOwnershipForm({
  action,
  eligibleMembers,
}: {
  action: (formData: FormData) => void;
  eligibleMembers: EligibleTarget[];
}) {
  if (eligibleMembers.length === 0) {
    // Deliberately no button here rather than a disabled/fake one — see
    // the pass instructions ("do not show a fake usable transfer
    // action").
    return <p className="text-[11px] text-ink/40">Add another member before transferring ownership.</p>;
  }

  return (
    <form
      action={action}
      onSubmit={(e) => {
        const formData = new FormData(e.currentTarget);
        const targetId = formData.get("target_member_id");
        const target = eligibleMembers.find((m) => m.id === targetId);
        const label = target?.label ?? "this member";
        const confirmed = window.confirm(
          `Transfer ownership to ${label}?\n\n${label} will become Owner. The current Owner will become Manager. This takes effect immediately.`
        );
        if (!confirmed) e.preventDefault();
      }}
      className="flex flex-wrap items-center gap-1.5"
    >
      <select
        name="target_member_id"
        defaultValue={eligibleMembers[0].id}
        className="rounded-lg border border-black/10 bg-white px-2 py-1 text-[11px] text-ink focus:border-ink/30 focus:outline-none"
      >
        {eligibleMembers.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} ({m.role})
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="rounded-lg border border-black/10 px-2 py-1 text-[11px] font-semibold text-ink transition hover:bg-black/[0.03]"
      >
        Transfer Ownership
      </button>
    </form>
  );
}

export function RemoveOwnerForm({
  action,
  ownerLabel,
}: {
  action: (formData: FormData) => void;
  ownerLabel: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        const confirmed = window.confirm(
          `Remove ${ownerLabel} as owner?\n\n` +
            "This removes their owner access. The business/event will have NO owner afterward. " +
            "Manager/staff memberships are unaffected. Ownership can be reassigned later via Transfer Ownership " +
            "or by approving a new claim."
        );
        if (!confirmed) e.preventDefault();
      }}
    >
      <button
        type="submit"
        className="rounded-lg border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-600 transition hover:bg-red-50"
      >
        Remove Owner
      </button>
    </form>
  );
}
