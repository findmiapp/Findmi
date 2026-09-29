import NameSlugFields from "@/components/admin/NameSlugFields";
import SubmitBar from "@/components/admin/SubmitBar";
import { TextField } from "@/components/admin/Fields";
import { createActivation } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewActivationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div>
      <h1 className="font-display text-page-title font-bold text-primary">Add Activation</h1>
      <p className="mt-1.5 text-body text-muted">
        Creates the Activation shell. Venues, Goals, Activation Families, and Inventory are configured after creation.
      </p>

      {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-body text-red-700">{error}</p>}

      <form action={createActivation} className="mt-5 flex flex-col gap-4 rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
        <TextField
          label="Internal Name"
          name="internal_name"
          required
          hint="Admin-only working title — never shown publicly."
          placeholder="e.g. FindMi Showroom: SoHo — Nov 2026"
        />
        <NameSlugFields
          isNew
          nameLabel="Public Name"
          nameName="public_name"
          slugHint="Auto-generated from the public name. Edit only if you need a specific URL."
        />
        <TextField label="Concept Label" name="concept_label" placeholder="e.g. FindMi Showroom, FindMi House, FindMi Market" />

        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="City" name="city" placeholder="e.g. New York" />
          <TextField label="Region" name="region" placeholder="e.g. NY" />
          <TextField label="Country Code" name="country_code" placeholder="e.g. US" hint="ISO 3166-1 alpha-2" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Default Timezone"
            name="default_timezone"
            defaultValue="America/New_York"
            hint="IANA timezone, e.g. America/New_York"
          />
          <TextField label="Currency" name="currency_code" defaultValue="USD" hint="ISO 4217, e.g. USD" />
        </div>

        <SubmitBar cancelHref="/admin/activations" saveLabel="Create Activation" />
      </form>
    </div>
  );
}
