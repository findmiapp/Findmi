import { CheckboxField, TextField, TextareaField } from "@/components/admin/Fields";
import ImageField from "@/components/admin/ImageField";
import NameSlugFields from "@/components/admin/NameSlugFields";
import SubmitBar from "@/components/admin/SubmitBar";
import DeleteButton from "@/components/admin/DeleteButton";
import PersonBusinessRoster from "@/components/admin/PersonBusinessRoster";
import type { Person } from "@/lib/types";
import type { PersonBusinessRow } from "@/lib/admin/people-queries";
import { savePerson, deletePerson } from "./actions";

export default function PersonForm({
  person,
  businesses,
  error,
}: {
  person: Person | null;
  businesses: PersonBusinessRow[];
  error?: string;
}) {
  const action = savePerson.bind(null, person?.id ?? null);

  return (
    <div className="flex flex-col gap-5">
      <form action={action} className="flex flex-col gap-5">
        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <CheckboxField
          label="Public"
          name="is_public"
          defaultChecked={person ? person.is_public : true}
          hint="Off keeps this person completely hidden from /people and every business profile — draft mode."
        />

        <NameSlugFields
          isNew={!person}
          defaultName={person?.name}
          defaultSlug={person?.slug}
          slugHint="Used in the public URL: /people/your-slug"
        />

        <ImageField label="Portrait" name="image_url" defaultValue={person?.image_url} />
        <TextareaField label="Short Bio" name="short_bio" defaultValue={person?.short_bio} rows={4} />
        <TextField label="Location" name="location" defaultValue={person?.location} placeholder="e.g. Staten Island, NY" />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Instagram"
            name="instagram_url"
            type="url"
            defaultValue={person?.instagram_url}
            placeholder="https://instagram.com/…"
          />
          <TextField
            label="Website"
            name="website_url"
            type="url"
            defaultValue={person?.website_url}
            placeholder="https://…"
          />
        </div>

        <CheckboxField
          label="Featured"
          name="is_featured"
          defaultChecked={person?.is_featured}
          hint="Shows in /people's Featured People row."
        />

        <PersonBusinessRoster initialBusinesses={businesses} />

        <SubmitBar cancelHref="/admin/people" />
      </form>

      {person && (
        <div className="border-t border-black/5 pt-5">
          <DeleteButton
            action={deletePerson.bind(null, person.id)}
            confirmMessage={`Delete "${person.name}"? This can't be undone.`}
          />
        </div>
      )}
    </div>
  );
}
