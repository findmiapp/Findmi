"use client";

import { useState } from "react";
import { SelectField } from "@/components/admin/Fields";
import { RelationField } from "@/components/admin/RelationPicker";
import { FORM_PURPOSE_LABELS, FORM_PURPOSES } from "@/lib/forms";
import type { FormEntityType, FormPurpose } from "@/lib/types";

const ENTITY_OPTIONS: { value: FormEntityType; label: string; searchEntity: "businesses" | "events" | "products" }[] = [
  { value: "business", label: "Business", searchEntity: "businesses" },
  { value: "event", label: "Event", searchEntity: "events" },
  { value: "product", label: "Product", searchEntity: "products" },
];

/** Assign this form to one specific business/event/product for one
 * purpose — overrides the global default for just that entity+purpose.
 * entity_type is controlled (it drives which entity the RelationField
 * searches) so it's a plain native select feeding the one hidden input
 * actually submitted, rather than a second, disconnected field. */
export default function AddAssignmentForm({
  formPurpose,
  action,
}: {
  formPurpose: FormPurpose;
  action: (formData: FormData) => void;
}) {
  const [entityType, setEntityType] = useState<FormEntityType>("business");
  const entityOption = ENTITY_OPTIONS.find((o) => o.value === entityType)!;

  return (
    <form action={action} className="flex flex-col gap-3 rounded-xl border border-black/10 bg-mist/40 p-3.5">
      <p className="text-sm font-semibold text-ink">Add Assignment</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Entity Type</span>
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value as FormEntityType)}
            className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink focus:border-ink/30 focus:outline-none"
          >
            {ENTITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <input type="hidden" name="entity_type" value={entityType} />
        </label>
        <SelectField
          label="Purpose"
          name="purpose"
          defaultValue={formPurpose}
          options={FORM_PURPOSES.map((p) => ({ value: p, label: FORM_PURPOSE_LABELS[p] }))}
        />
      </div>
      <RelationField
        key={entityType}
        label="Record"
        name="entity_id"
        entity={entityOption.searchEntity}
        initial={null}
        clearLabel={null}
      />
      <button
        type="submit"
        className="self-start rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink transition hover:bg-findmi-600"
      >
        Assign
      </button>
    </form>
  );
}
