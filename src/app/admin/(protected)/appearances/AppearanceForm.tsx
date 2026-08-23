import { CheckboxField, DateTimeField, NumberField, SelectField, TextField, TextareaField } from "@/components/admin/Fields";
import { RelationField } from "@/components/admin/RelationPicker";
import SubmitBar from "@/components/admin/SubmitBar";
import DeleteButton from "@/components/admin/DeleteButton";
import type { AdminAppearance, SelectOption } from "@/lib/admin/queries";
import { isoToLocalDateTime } from "@/lib/admin/form-helpers";
import { saveAppearance, deleteAppearance } from "./actions";

export default function AppearanceForm({
  appearance,
  initialBusiness,
  initialEvent,
  error,
}: {
  appearance: AdminAppearance | null;
  initialBusiness: SelectOption | null;
  initialEvent: SelectOption | null;
  error?: string;
}) {
  const action = saveAppearance.bind(null, appearance?.id ?? null);

  return (
    <div className="flex flex-col gap-5">
      <form action={action} className="flex flex-col gap-5">
        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <RelationField
          label="Appearing Business"
          name="business_id"
          entity="businesses"
          initial={initialBusiness}
          clearLabel={null}
          hint="Which business is appearing."
          createHref="/admin/businesses/new"
          createLabel="New Business"
        />

        <RelationField
          label="Related FindMi Event"
          name="event_id"
          entity="events"
          initial={initialEvent}
          clearLabel="No event — link to Google Maps directions instead"
          hint="If set, the public appearance card links to this FindMi event page instead of Maps."
          createHref="/admin/events/new"
          createLabel="New Event"
        />

        <TextField
          label="Appearance Title"
          name="title"
          defaultValue={appearance?.title}
          required
          hint="What shows on the card — e.g. 'Minthorne Market'."
        />
        <TextareaField label="Notes" name="description" defaultValue={appearance?.description} rows={3} />

        <div className="grid gap-4 sm:grid-cols-2">
          <DateTimeField
            label="Start Date & Time"
            name="start_at"
            defaultValue={isoToLocalDateTime(appearance?.start_at ?? null)}
            required
            hint="Eastern time (America/New_York)."
          />
          <DateTimeField
            label="End Date & Time"
            name="end_at"
            defaultValue={isoToLocalDateTime(appearance?.end_at ?? null)}
            hint="Optional. Also Eastern time."
          />
        </div>

        <TextField label="Venue Name" name="venue_name" defaultValue={appearance?.venue_name} />
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Address" name="address" defaultValue={appearance?.address} />
          <TextField label="City" name="city" defaultValue={appearance?.city} />
          <TextField label="State" name="state" defaultValue={appearance?.state} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Status"
            name="status"
            defaultValue={appearance?.status ?? "confirmed"}
            options={[
              { value: "confirmed", label: "Confirmed" },
              { value: "tentative", label: "Tentative" },
              { value: "canceled", label: "Canceled (hidden from the public)" },
            ]}
          />
          <CheckboxField label="Featured" name="is_featured" defaultChecked={appearance?.is_featured} />
        </div>

        <div className="rounded-2xl border border-black/10 p-4">
          <p className="mb-3 text-sm font-semibold text-ink">Brand Bulletin</p>
          <div className="flex flex-col gap-4">
            <TextareaField
              label="Bulletin Text"
              name="bulletin_text"
              defaultValue={appearance?.bulletin_text}
              rows={2}
              hint={'A short, human line — e.g. "Rosie is back at Minthorne this Saturday with build-your-own bouquets + cold brew." Falls back to a plain title/venue line if left blank.'}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <CheckboxField
                label="Show on Homepage"
                name="show_on_home"
                defaultChecked={appearance?.show_on_home}
                hint="Off by default — only explicitly enabled appearances appear on the homepage."
              />
              <NumberField
                label="Homepage Order"
                name="home_sort_order"
                defaultValue={appearance?.home_sort_order ?? undefined}
                hint="Only matters when Show on Homepage is on."
              />
            </div>
          </div>
        </div>

        <SubmitBar cancelHref="/admin/appearances" />
      </form>

      {appearance && (
        <div className="border-t border-black/5 pt-5">
          <DeleteButton
            action={deleteAppearance.bind(null, appearance.id)}
            confirmMessage={`Delete "${appearance.title}"? This can't be undone.`}
          />
        </div>
      )}
    </div>
  );
}
