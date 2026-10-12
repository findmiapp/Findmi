"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";
import { TextField, TextareaField } from "@/components/admin/Fields";
import { RelationField } from "@/components/admin/RelationPicker";
import SubmitBar from "@/components/admin/SubmitBar";
import type { SearchResult } from "@/components/admin/useAdminSearch";
import { CONTACT_LIMITS } from "@/lib/bd/domain";
import type { ContactSaveResult } from "./actions";

export interface ContactFormValues {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

/** Private BD Contact create/edit — the same onSubmit + useActionState
 * pattern as OrganizationForm, so a rejected save keeps everything typed.
 * The Organization picker searches PRIVATE BD Organizations (Admin search
 * entity `bd_organizations`); archived ones are listed but not pickable. */
export default function ContactForm({
  contact,
  initialOrganization,
  action,
  saveLabel,
  cancelHref,
}: {
  contact: ContactFormValues | null;
  initialOrganization: SearchResult | null;
  action: (formData: FormData) => Promise<ContactSaveResult>;
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

      <TextField label="Name" name="name" defaultValue={contact?.name} required hint={`Up to ${CONTACT_LIMITS.name} characters.`} />

      <div className="rounded-2xl border border-black/[0.07] bg-white p-4">
        <RelationField
          label="Organization (Optional)"
          name="organization_id"
          entity="bd_organizations"
          initial={initialOrganization}
          placeholder="Search private Organizations…"
          clearLabel="No Organization"
          badgeFor={(r) => (r.archived ? "Archived" : null)}
          hint="A private BD Organization. Changing this never changes the Organization itself."
        />
      </div>

      <TextField label="Title (Optional)" name="title" defaultValue={contact?.title} placeholder="e.g. Director of Partnerships" />

      <div className="grid gap-5 sm:grid-cols-2">
        <TextField label="Email (Optional)" name="email" defaultValue={contact?.email} placeholder="name@company.com" />
        <TextField label="Phone (Optional)" name="phone" type="tel" defaultValue={contact?.phone} />
      </div>

      <TextareaField label="Private Notes (Optional)" name="notes" defaultValue={contact?.notes} rows={5} hint={`Internal only. Up to ${CONTACT_LIMITS.notes} characters.`} />

      <SubmitBar cancelHref={cancelHref} saveLabel={saveLabel} pending={pending} />
    </form>
  );
}
