"use client";

import { CheckboxList, SelectField, TextareaField, TextField } from "@/components/admin/Fields";
import { RelationField } from "@/components/admin/RelationPicker";
import SubmitBar from "@/components/admin/SubmitBar";
import type { SelectOption } from "@/lib/admin/queries";
import type { AdminMembershipRow } from "@/lib/admin/membership-queries";
import type { Market, MembershipPlan } from "@/lib/types";

export default function MembershipEditForm({
  membership,
  plans,
  markets,
  selectedMarketIds,
  existingBusinessOption,
  action,
}: {
  membership: AdminMembershipRow;
  plans: MembershipPlan[];
  markets: Market[];
  selectedMarketIds: string[];
  existingBusinessOption: SelectOption | null;
  action: (formData: FormData) => void;
}) {
  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Business Name"
          name="intended_business_name"
          defaultValue={membership.intended_business_name}
          required
        />
        <SelectField
          label="Plan"
          name="plan_id"
          defaultValue={membership.plan_id ?? undefined}
          options={plans.map((p) => ({ value: p.id, label: `${p.name} — $${p.annual_price}/yr` }))}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Contact Name" name="contact_name" defaultValue={membership.contact_name} />
        <TextField
          label="Contact Email"
          name="contact_email"
          type="email"
          defaultValue={membership.contact_email}
          required
        />
      </div>
      <TextField label="Contact Phone" name="contact_phone" type="tel" defaultValue={membership.contact_phone} />

      <SelectField
        label="Billing Status"
        name="billing_status"
        defaultValue={membership.billing_status}
        options={[
          { value: "comped", label: "Comped" },
          { value: "pending_payment", label: "Pending Payment" },
          { value: "paid", label: "Paid" },
          { value: "past_due", label: "Past Due" },
          { value: "cancelled", label: "Cancelled" },
        ]}
        hint="Onboarding and publication status are tracked separately — approve/reject/pause below."
      />

      <CheckboxList
        label="Markets"
        name="market_ids"
        defaultSelected={selectedMarketIds}
        options={markets.map((m) => ({ value: m.id, label: m.name }))}
      />

      <RelationField
        label="Link to Existing Business"
        name="existing_business_id"
        entity="businesses"
        initial={existingBusinessOption}
        clearLabel="None — a new business will be created on submission"
        hint="The intake webhook updates this business instead of creating a new one, once set."
      />

      <TextareaField label="Admin Notes" name="admin_notes" defaultValue={membership.admin_notes} rows={4} />

      <SubmitBar cancelHref="/admin/onboarding" />
    </form>
  );
}
