import { CheckboxField, SelectField, TextareaField, TextField } from "@/components/admin/Fields";
import ImageField from "@/components/admin/ImageField";
import NameSlugFields from "@/components/admin/NameSlugFields";
import SubmitBar from "@/components/admin/SubmitBar";
import DeleteButton from "@/components/admin/DeleteButton";
import type { AdminLocation } from "@/lib/admin/queries";
import type { AdminMarketOption } from "@/lib/admin/business-markets";
import { saveLocation, deleteLocation } from "./actions";

export default function LocationForm({
  location,
  markets,
  error,
}: {
  location: AdminLocation | null;
  markets: AdminMarketOption[];
  error?: string;
}) {
  const action = saveLocation.bind(null, location?.id ?? null);

  return (
    <div className="flex flex-col gap-5">
      <form action={action} className="flex flex-col gap-5">
        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <CheckboxField
          label="Published"
          name="published"
          defaultChecked={location ? !location.is_demo : true}
          hint="On = visible to the public. Off = hidden (demo/test only)."
        />

        <NameSlugFields
          isNew={!location}
          nameLabel="Location Name"
          defaultName={location?.name}
          defaultSlug={location?.slug}
          slugHint="Used in the public URL: /location/your-slug"
        />

        <TextField label="Address" name="address" defaultValue={location?.address} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="City" name="city" defaultValue={location?.city} />
          <TextField label="State" name="state" defaultValue={location?.state} />
        </div>

        <TextareaField
          label="Description"
          name="description"
          defaultValue={location?.description}
          hint="Shown on the public venue page. Owner-editable from the Location Manager too."
        />
        <ImageField label="Cover Image" name="cover_image_url" defaultValue={location?.cover_image_url} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Website" name="website_url" type="url" defaultValue={location?.website_url} />
          <TextField label="Email" name="email" type="email" defaultValue={location?.email} />
        </div>
        <TextField label="Phone" name="phone" type="tel" defaultValue={location?.phone} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Latitude"
            name="latitude"
            defaultValue={location?.latitude ?? undefined}
            hint="Optional."
          />
          <TextField
            label="Longitude"
            name="longitude"
            defaultValue={location?.longitude ?? undefined}
            hint="Optional."
          />
        </div>

        <SelectField
          label="Findmi Market"
          name="market_id"
          defaultValue={location?.market_id ?? ""}
          options={[
            { value: "", label: "Unassigned" },
            ...markets
              .filter((m) => m.active || m.id === location?.market_id)
              .map((m) => ({ value: m.id, label: m.name })),
          ]}
          hint="This is the physical Findmi Market this venue belongs to. Event occurrences linked to this location can inherit it."
        />

        {/* Highperlocal Prep, Pass 1 — classifies this individual retail
            LOCATION, never a parent Business/brand. Nullable/unselected by
            default — never guessed. Becomes the authoritative
            classification for any Appearance that links here via its own
            Canonical Location field (see admin/appearances). */}
        <SelectField
          label="Retail Classification"
          name="classification"
          defaultValue={location?.classification ?? ""}
          options={[
            { value: "", label: "Unclassified" },
            { value: "adult_use", label: "Adult Use" },
            { value: "medical", label: "Medical" },
            { value: "adult_use_medical", label: "Adult Use + Medical" },
            { value: "hemp_store", label: "Hemp Store" },
            { value: "other", label: "Other" },
          ]}
          hint="What kind of retail location this physically is — used by any Appearance that links here as its Canonical Location."
        />

        <SubmitBar cancelHref="/admin/locations" />
      </form>

      {location && (
        <div className="border-t border-black/5 pt-5">
          <p className="mb-2 text-xs text-ink/45">
            Deleting removes this location permanently. Any event occurrence or
            appearance linked here as its Canonical Location simply loses that
            link (its own venue/address fields are unaffected) — nothing else
            is deleted.
          </p>
          <DeleteButton
            action={deleteLocation.bind(null, location.id)}
            confirmMessage={`Delete "${location.name}"? This can't be undone.`}
          />
        </div>
      )}
    </div>
  );
}
