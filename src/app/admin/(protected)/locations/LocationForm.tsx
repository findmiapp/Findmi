import { CheckboxField, SelectField, TextareaField, TextField } from "@/components/admin/Fields";
import { RelationField } from "@/components/admin/RelationPicker";
import ImageField from "@/components/admin/ImageField";
import { LinkedNameInput, LinkedNameSlugProvider, LinkedSlugInput } from "@/components/admin/LinkedNameSlug";
import SubmitBar from "@/components/admin/SubmitBar";
import DeleteButton from "@/components/admin/DeleteButton";
import MarketAreaFields, { type MarketWithAreaOptions } from "@/components/MarketAreaFields";
import CategorySubcategoryField from "@/components/admin/CategorySubcategoryField";
import LocationHoursField from "@/components/admin/LocationHoursField";
import type { AdminLocation, SelectOption } from "@/lib/admin/queries";
import { PLACE_TYPES, PLACE_TYPE_LABELS } from "@/lib/place-types";
import type { Category } from "@/lib/types";
import { saveLocation, deleteLocation } from "./actions";

export default function LocationForm({
  location,
  initialParent,
  marketsWithAreas,
  categories,
  error,
}: {
  location: AdminLocation | null;
  initialParent: SelectOption | null;
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

        {/* Location Admin UX cleanup — the editor reads as five plain
            questions: what place is this, where is it, is it inside
            another place, its public details, then FindMi-only settings.
            Field names, values and save behavior are unchanged; only
            grouping, order and copy moved. Three distinct concepts are
            kept visibly separate: postal address (Where), physical
            containment (Physical Context), and discovery organization
            (Market/Area, in FindMi Settings). */}
        <LinkedNameSlugProvider isNew={!location} defaultSlug={location?.slug}>
          <FormSection title="Place">
            <LinkedNameInput label="Location Name" defaultValue={location?.name} placeholder="e.g. Eataly Chiosco" />
            <SelectField
              label="Place Type"
              name="place_type"
              defaultValue={location?.place_type ?? ""}
              hint="What kind of physical place is this? (optional)"
              options={[
                { value: "", label: "Not set" },
                ...PLACE_TYPES.map((t) => ({ value: t, label: PLACE_TYPE_LABELS[t] })),
              ]}
            />
            <div>
              <CategorySubcategoryField categories={categories} defaultCategoryId={location?.category_id} />
              <p className="mt-1 text-xs text-ink/45">What is this place known for?</p>
            </div>
            <CheckboxField
              label="Published"
              name="published"
              defaultChecked={location ? !location.is_demo : true}
              hint="Visible on Findmi. Off keeps it hidden."
            />
          </FormSection>

          <FormSection title="Where">
            <TextField label="Address" name="address" defaultValue={location?.address} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
              <div className="col-span-2 sm:col-span-1">
                <TextField label="City" name="city" defaultValue={location?.city} />
              </div>
              <TextField label="State" name="state" defaultValue={location?.state} />
              <TextField label="ZIP Code" name="postal_code" defaultValue={location?.postal_code} />
            </div>
          </FormSection>

          {/* Physical Presence Pass 2 — parent_location_id is PHYSICAL
              containment only (never ownership/operator/partner); the
              database rejects any choice that would form a loop. */}
          <FormSection title="Physical Context">
            <RelationField
              label="Parent Place (optional)"
              name="parent_location_id"
              entity="locations"
              initial={initialParent}
              excludeValue={location?.id ?? null}
              clearLabel="No parent place"
              placeholder="Search Findmi locations…"
              hint="Is this place physically inside or part of another place? e.g. Eataly Chiosco → Flatiron North Plaza"
            />
          </FormSection>

          <FormSection title="Details">
            <TextareaField
              label="Description"
              name="description"
              defaultValue={location?.description}
              hint="Shown on the public page."
            />
            <ImageField label="Cover Image" name="cover_image_url" defaultValue={location?.cover_image_url} />
            <ImageField label="Logo / Profile Image (square works best)" name="logo_url" defaultValue={location?.logo_url} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Website" name="website_url" type="url" defaultValue={location?.website_url} />
              <TextField label="Email" name="email" type="email" defaultValue={location?.email} />
            </div>
            <TextField label="Phone" name="phone" type="tel" defaultValue={location?.phone} />
            <LocationHoursField name="hours" defaultValue={location?.hours ?? null} />
          </FormSection>

          {/* Secondary, collapsed by default (native <details> — keyboard
              accessible, and its inputs still submit while closed). Holds
              the URL slug, map coordinates and discovery Market/Area. */}
          <details className="group rounded-2xl border border-black/10 bg-black/[0.015]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
              <span>
                <span className="block text-xs font-bold uppercase tracking-wide text-ink/50">Findmi Settings</span>
                <span className="mt-0.5 block text-xs text-ink/45">URL, map coordinates, Market &amp; Area</span>
              </span>
              <span aria-hidden="true" className="text-ink/40 transition group-open:rotate-180">
                ▾
              </span>
            </summary>
            <div className="flex flex-col gap-4 border-t border-black/5 px-4 pb-4 pt-4">
              <LinkedSlugInput hint="Public URL: /location/your-slug. Auto-generated from the name." />
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                <TextField label="Latitude" name="latitude" defaultValue={location?.latitude ?? undefined} />
                <TextField label="Longitude" name="longitude" defaultValue={location?.longitude ?? undefined} />
              </div>
              <div>
                <MarketAreaFields
                  markets={marketsWithAreas}
                  defaultMarketId={location?.market_id ?? null}
                  defaultAreaId={location?.market_area_id ?? null}
                  marketLabel="Market (optional)"
                  areaLabel="Area (optional)"
                />
                <p className="mt-1.5 text-xs text-ink/45">
                  Market is used by Findmi to organize discovery by city or region. Area is an optional neighborhood or
                  local area within that Market.
                </p>
              </div>
            </div>
          </details>
        </LinkedNameSlugProvider>

        <SubmitBar cancelHref="/admin/locations" />
      </form>

      {location && (
        <div className="border-t border-black/5 pt-5">
          <p className="mb-2 text-xs text-ink/45">
            Deleting removes this location permanently. Any Event date or Business appearance linked to it keeps its
            own record — it just loses this Location link (falls back to its plain venue name/address text) rather
            than being deleted itself.
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

/** One plain-language group of the Location editor — same bordered card
 * and small uppercase heading the admin forms already use for grouped
 * fields. */
function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-black/10 p-4">
      <h2 className="text-xs font-bold uppercase tracking-wide text-ink/50">{title}</h2>
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </section>
  );
}
