"use client";

import { useRef, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import { RelationField } from "@/components/admin/RelationPicker";
import { planEventReassignment } from "@/lib/admin/ownership-plan";

/** A submit button that asks first. Renders inside a server <form action>;
 * confirming submits that form — nothing changes until Confirm. */
export function ConfirmSubmitButton({
  label,
  title,
  message,
  confirmLabel,
  tone = "neutral",
}: {
  label: string;
  title: string;
  message: string;
  confirmLabel: string;
  tone?: "neutral" | "primary" | "danger";
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const cls =
    tone === "primary"
      ? "rounded-lg bg-findmi px-3 py-1.5 text-sm font-semibold text-white hover:bg-findmi-600"
      : tone === "danger"
        ? "rounded-lg border border-red-200 px-3 py-1.5 text-sm font-semibold text-red-700 hover:border-red-300"
        : "rounded-lg border border-black/15 px-3 py-1.5 text-sm font-semibold text-ink hover:border-black/30";
  return (
    <>
      <button ref={ref} type="button" className={cls} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <ConfirmDialog
          title={title}
          message={message}
          cancelLabel="Cancel"
          confirmLabel={confirmLabel}
          pendingLabel="Saving…"
          pending={pending}
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            setPending(true);
            ref.current?.form?.requestSubmit();
          }}
        />
      )}
    </>
  );
}

/** Reassign Managing Page — search an existing Business, confirm with the
 * exact plan (what changes / what doesn't), then submit. */
export function EventReassignForm({
  action,
  eventName,
  currentHost,
  directManagers,
}: {
  action: (formData: FormData) => void | Promise<void>;
  eventName: string;
  currentHost: { id: string; name: string } | null;
  directManagers: { memberId: string; label: string }[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [next, setNext] = useState<{ id: string; name: string } | null>(currentHost);
  const [removeDirect, setRemoveDirect] = useState(directManagers.length > 0);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const plan = next ? planEventReassignment({ eventName, currentHost, nextHost: next, directManagers, removeDirect }) : null;
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-3">
      <RelationField
        label="Reassign Managing Page"
        name="business_id"
        entity="businesses"
        placeholder="Search Businesses"
        clearLabel={null}
        initial={currentHost ? { value: currentHost.id, label: currentHost.name } : null}
        onSelect={(r) => setNext(r ? { id: r.value, name: r.label } : null)}
      />
      {directManagers.length > 0 && (
        <label className="flex items-start gap-2 text-sm text-ink/75">
          <input type="checkbox" className="mt-0.5 accent-findmi" checked={removeDirect} onChange={(e) => setRemoveDirect(e.target.checked)} />
          <span>Also remove direct management ({directManagers.map((m) => m.label).join(", ")})</span>
        </label>
      )}
      {plan?.removeMemberIds.map((id) => <input key={id} type="hidden" name="remove_member_id" value={id} />)}
      <button
        type="button"
        disabled={!plan || (next?.id === currentHost?.id && plan.removeMemberIds.length === 0)}
        onClick={() => setOpen(true)}
        className="w-fit rounded-lg bg-findmi px-3 py-1.5 text-sm font-semibold text-white hover:bg-findmi-600 disabled:opacity-40"
      >
        Review Reassignment
      </button>
      {open && plan && (
        <ConfirmDialog
          title={plan.title}
          message={plan.message}
          cancelLabel="Cancel"
          confirmLabel="Confirm Reassignment"
          pendingLabel="Reassigning…"
          pending={pending}
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            setPending(true);
            formRef.current?.requestSubmit();
          }}
        />
      )}
    </form>
  );
}
