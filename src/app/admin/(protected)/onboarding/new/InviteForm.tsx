"use client";

import { CheckboxList, SelectField, TextareaField, TextField } from "@/components/admin/Fields";
import { RelationField } from "@/components/admin/RelationPicker";
import SubmitBar from "@/components/admin/SubmitBar";
import type { Market, MembershipPlan } from "@/lib/types";

export default function InviteForm({
  plans,
  markets,
  action,
}: {
  plans: MembershipPlan[];
  markets: Market[];
  action: (formData: FormData) => void;
}) {
  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Business Name" name="intended_business_name" required />
        <SelectField
          label="Plan"
          name="plan_id"
          defaultValue={plans.find((p) => p.slug === "founding-500")?.id}
          options={plans.map((p) => ({ value: p.id, label: `${p.name} — $${p.annual_price}/yr` }))}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Contact Name" name="contact_name" />
        <TextField label="Contact Email" name="contact_email" type="email" required />
      </div>
      <TextField label="Contact Phone" name="contact_phone" type="tel" />

      <CheckboxList
        label="Markets"
        name="market_ids"
        defaultSelected={[]}
        options={markets.map((m) => ({ value: m.id, label: m.name }))}
      />

      <RelationField
        label="Link to Existing Business (optional)"
        name="existing_business_id"
        entity="businesses"
        initial={null}
        clearLabel="Create a new business on submission"
        hint="Only set this if the vendor already has a business record — the intake webhook will update it instead of creating a duplicate."
      />

      <TextareaField label="Admin Notes" name="admin_notes" rows={3} />

      <SubmitBar cancelHref="/admin/onboarding" saveLabel="Create Invite" />
    </form>
  );
}
