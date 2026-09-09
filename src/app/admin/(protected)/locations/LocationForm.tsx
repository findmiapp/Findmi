import { CheckboxField, TextareaField, TextField } from "@/components/admin/Fields";
import ImageField from "@/components/admin/ImageField";
import NameSlugFields from "@/components/admin/NameSlugFields";
import SubmitBar from "@/components/admin/SubmitBar";
import DeleteButton from "@/components/admin/DeleteButton";
import MarketAreaFields, { type MarketWithAreaOptions } from "@/components/MarketAreaFields";
import CategorySubcategoryField from "@/components/admin/CategorySubcategoryField";
import LocationHoursField from "@/components/admin/LocationHoursField";
import type { AdminLocation } from "@/lib/admin/queries";
import type { Category } from "@/lib/types";
import { saveLocation, deleteLocation } from "./actions";

export default function LocationForm({
  location,
  marketsWithAreas,
  categories,
  error,
}: {
  location: AdminLocation | null;
  marketsWithAreas: MarketWithAreaOptions[];
  categories: Category[];
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
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="City" name="city" defaultValue={location?.city} />
          <TextField label="State" name="state" defaultValue={location?.state} />
          <TextField label="ZIP Code" name="postal_code" defaultValue={location?.postal_code} />
        </div>

        <CategorySubcategoryField categories={categories} defaultCategoryId={location?.category_id} />

        <TextareaField
          label="Description"
          name="description"
          defaultValue={location?.description}
          hint="Shown on the public venue page. Owner-editable from the Location Manager too."
        />
        <ImageField label="Cover Image" name="cover_image_url" defaultValue={location?.cover_image_url} />
        <ImageField label="Logo / Profile Image (square works best)" name="logo_url" defaultValue={location?.logo_url} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Website" name="website_url" type="url" defaultValue={location?.website_url} />
          <TextField label="Email" name="email" type="email" defaultValue={location?.email} />
        </div>
        <TextField label="Phone" name="phone" type="tel" defaultValue={location?.phone} />

        <LocationHoursField name="hours" defaultValue={location?.hours ?? null} />
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

        {/* Location Market -> Area Parity pass — same cascading Market ->
            Area picker Events already use (MarketAreaFields), replacing the
            old plain Market-only select. Changing Market clears an
            incompatible Area client-side; saveLocation re-validates
            server-side via isAreaInMarket regardless. */}
        <div className="rounded-2xl border border-black/10 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Findmi Market / Area</p>
          <p className="mt-1 text-xs text-ink/50">
            The physical Findmi Market (and, optionally, Area) this venue belongs to. Event occurrences linked to
            this location can inherit its Market.
          </p>
          <div className="mt-3">
            <MarketAreaFields
              markets={marketsWithAreas}
              defaultMarketId={location?.market_id ?? null}
              defaultAreaId={location?.market_area_id ?? null}
            />
          </div>
        </div>

        <SubmitBar cancelHref="/admin/locations" />
      </form>

      {location && (
        <div className="border-t border-black/5 pt-5">
          <p className="mb-2 text-xs text-ink/45">
            Deleting removes this location permanently. It doesn&rsquo;t affect any
            business, event, or appearance — locations aren&rsquo;t linked to them yet.
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
