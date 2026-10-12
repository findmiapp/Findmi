"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";
import { SelectField, TextField, TextareaField } from "@/components/admin/Fields";
import { RelationField } from "@/components/admin/RelationPicker";
import SubmitBar from "@/components/admin/SubmitBar";
import type { SearchResult } from "@/components/admin/useAdminSearch";
import { ORGANIZATION_KINDS, ORGANIZATION_KIND_LABELS, ORGANIZATION_LIMITS } from "@/lib/bd/domain";
import type { OrganizationSaveResult } from "./actions";

export interface OrganizationFormValues {
  name: string;
  kind: string | null;
  website: string | null;
  notes: string | null;
}

/** Private BD Organization create/edit. Submits through onSubmit +
 * useActionState (the Opportunities form pattern) so a rejected save keeps
 * everything typed — the action returns { error } and only redirects on
 * success. Private data never reaches this component except the row being
 * edited, rendered server-side by its page. */
export default function OrganizationForm({
  organization,
  initialBusiness,
  action,
  saveLabel,
  cancelHref,
}: {
  organization: OrganizationFormValues | null;
  initialBusiness: SearchResult | null;
  action: (formData: FormData) => Promise<OrganizationSaveResult>;
  saveLabel: string;
  cancelHref: string;
}) {
  const errorRef = useRef<HTMLParagraphElement>(null);
  const [state, dispatch, pending] = useActionState<{ error: string | null; attempt: number }, FormData>(
    async (prev, formData) => {
      const result = await action(formData);
      return { error: result?.error ?? null, attempt: prev.attempt + 1 };
    },
    { error: null, attempt: 0 }
  );

  useEffect(() => {
    if (state.error) errorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [state]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const formData = new FormData(e.currentTarget);
    startTransition(() => dispatch(formData));
  }

  const shownError = pending ? null : state.error;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {shownError && (
        <p ref={errorRef} role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {shownError}
        </p>
      )}

      <TextField label="Name" name="name" defaultValue={organization?.name} required hint={`Up to ${ORGANIZATION_LIMITS.name} characters.`} />

      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField
          label="Kind (Optional)"
          name="kind"
          defaultValue={organization?.kind ?? ""}
          options={[{ value: "", label: "Not set" }, ...ORGANIZATION_KINDS.map((k) => ({ value: k, label: ORGANIZATION_KIND_LABELS[k] }))]}
          hint="Descriptive only."
        />
        <TextField label="Website (Optional)" name="website" type="url" defaultValue={organization?.website} placeholder="https://…" />
      </div>

      <div className="rounded-2xl border border-black/[0.07] bg-white p-4">
        <RelationField
          label="Linked Findmi Business (Optional)"
          name="business_id"
          entity="businesses"
          initial={initialBusiness}
          placeholder="Search public Findmi Businesses…"
          clearLabel="Not linked"
          hint="References an existing public Findmi Business. Nothing is copied, synced or changed on that Business."
        />
      </div>

      <TextareaField label="Private Notes (Optional)" name="notes" defaultValue={organization?.notes} rows={5} hint={`Internal only. Up to ${ORGANIZATION_LIMITS.notes} characters.`} />

      <SubmitBar cancelHref={cancelHref} saveLabel={saveLabel} pending={pending} />
    </form>
  );
}
