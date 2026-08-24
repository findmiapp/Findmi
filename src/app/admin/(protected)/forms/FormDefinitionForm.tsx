import { CheckboxField, SelectField, TextField } from "@/components/admin/Fields";
import SubmitBar from "@/components/admin/SubmitBar";
import { FORM_PURPOSE_LABELS, FORM_PURPOSES } from "@/lib/forms";
import type { FindmiForm } from "@/lib/types";
import { saveForm } from "./actions";

export default function FormDefinitionForm({
  form,
  error,
}: {
  form: FindmiForm | null;
  error?: string;
}) {
  const action = saveForm.bind(null, form?.id ?? null);

  return (
    <form action={action} className="flex flex-col gap-5">
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Form Name" name="name" defaultValue={form?.name} required hint="Founder-facing label only." />
        <TextField
          label="Slug"
          name="slug"
          defaultValue={form?.slug}
          required
          hint="Internal identifier, e.g. general-inquiry-2026."
        />
      </div>

      <TextField
        label="Tally URL"
        name="form_url"
        type="url"
        defaultValue={form?.form_url}
        required
        placeholder="https://tally.so/r/…"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Purpose"
          name="purpose"
          defaultValue={form?.purpose ?? FORM_PURPOSES[0]}
          options={FORM_PURPOSES.map((p) => ({ value: p, label: FORM_PURPOSE_LABELS[p] }))}
        />
        <SelectField
          label="Display Mode"
          name="display_mode"
          defaultValue={form?.display_mode ?? "external"}
          options={[
            { value: "external", label: "External — opens in a new tab" },
            { value: "embed", label: "Embed — opens inside FindMi" },
          ]}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <CheckboxField label="Active" name="is_active" defaultChecked={form ? form.is_active : true} />
        <CheckboxField
          label="Default for this purpose"
          name="is_default"
          defaultChecked={form?.is_default}
          hint="Used whenever no business/event/product overrides this purpose. Only one default per purpose — setting this clears any other."
        />
      </div>

      <SubmitBar cancelHref="/admin/forms" />
    </form>
  );
}
