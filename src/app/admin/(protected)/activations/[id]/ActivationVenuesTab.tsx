import { TextField, DateTimeField, SelectField, CheckboxField } from "@/components/admin/Fields";
import { RelationField } from "@/components/admin/RelationPicker";
import SubmitBar from "@/components/admin/SubmitBar";
import { getLocationOptionById } from "@/lib/admin/queries";
import { isoToLocalDateTime, localDateTimeToIso } from "@/lib/admin/form-helpers";
import type { AdminActivationVenue } from "@/lib/admin/activations";
import { createActivationVenue, deleteActivationVenue, saveActivationVenue } from "../actions";

const VENUE_STATUS_OPTIONS = [
  { value: "planned", label: "Planned" },
  { value: "confirmed", label: "Confirmed" },
  { value: "cancelled", label: "Cancelled" },
];

/** Multi-venue support exists structurally from day one (audit §5) even
 * though FindMi Showroom: SoHo initially uses exactly one row — see the
 * frozen architecture audit + amendment. Each venue is its own small,
 * independently-savable form (not a bulk-save-all-rows list) since a
 * venue carries genuinely richer fields (a Location relationship, two
 * dates, a status) than a simple name/slug config row — the same
 * "smaller form, its own split action" principle Businesses/Events
 * already use per tab, applied here at the row level. */
export default async function ActivationVenuesTab({
  activationId,
  venues,
}: {
  activationId: string;
  venues: AdminActivationVenue[];
}) {
  const initialLocations = await Promise.all(venues.map((v) => getLocationOptionById(v.location_id)));
  const createVenue = createActivationVenue.bind(null, activationId);

  return (
    <div className="flex flex-col gap-4">
      <form action={createVenue} className="flex flex-wrap items-end gap-3 rounded-2xl border border-dashed border-black/15 bg-white p-3.5">
        <div className="min-w-[200px] flex-1">
          <TextField label="New Venue Name" name="name" placeholder="e.g. SoHo Showroom" />
        </div>
        <button type="submit" className="h-11 shrink-0 rounded-2xl bg-findmi px-5 text-button font-bold uppercase text-white transition hover:bg-findmi-600">
          + Add Venue
        </button>
      </form>

      {venues.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-black/10 px-4 py-8 text-center text-body text-muted">
          No venues yet. Add one above — FindMi Showroom: SoHo can start with a single venue.
        </p>
      ) : (
        venues.map((venue, i) => {
          const saveVenue = saveActivationVenue.bind(null, activationId, venue.id);
          const deleteVenue = deleteActivationVenue.bind(null, activationId, venue.id);
          return (
            <form
              key={venue.id}
              action={saveVenue}
              className="flex flex-col gap-4 rounded-2xl border border-black/5 bg-white p-3.5 sm:p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-card-title font-semibold text-primary">{venue.name || `Venue ${i + 1}`}</p>
                {venue.is_primary && (
                  <span className="shrink-0 rounded-full bg-findmi-50 px-2.5 py-1 text-label font-bold uppercase text-accent">Primary</span>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Venue Name" name="name" defaultValue={venue.name} />
                <RelationField
                  label="Findmi Location (optional)"
                  name="location_id"
                  entity="locations"
                  initial={initialLocations[i]}
                  clearLabel="No Location linked yet"
                  createHref="/admin/locations/new"
                  createLabel="Create New Location"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <TextField label="City" name="city" defaultValue={venue.city} />
                <TextField label="Region" name="region" defaultValue={venue.region} />
                <TextField label="Country Code" name="country_code" defaultValue={venue.country_code} hint="ISO 3166-1 alpha-2" />
              </div>
              <TextField label="Timezone" name="timezone" defaultValue={venue.timezone} hint="IANA timezone, e.g. America/New_York" />

              <div className="grid gap-4 sm:grid-cols-2">
                <DateTimeField
                  label="Starts"
                  name="start_at"
                  defaultValue={venue.start_at ? isoToLocalDateTime(venue.start_at, venue.timezone ?? undefined) : null}
                />
                <DateTimeField
                  label="Ends"
                  name="end_at"
                  defaultValue={venue.end_at ? isoToLocalDateTime(venue.end_at, venue.timezone ?? undefined) : null}
                />
              </div>
              {/* datetime-local posts "YYYY-MM-DDTHH:mm" with no timezone
                  context — saveActivationVenue converts it using this same
                  form's submitted `timezone` field via
                  lib/admin/form-helpers.ts's localDateTimeToIso, the exact
                  pattern event_occurrences editing already uses. */}

              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField label="Status" name="status" defaultValue={venue.status} options={VENUE_STATUS_OPTIONS} />
                <div className="flex items-end">
                  <CheckboxField label="Primary Venue" name="is_primary" defaultChecked={venue.is_primary} />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-black/5 pt-3">
                <button
                  type="submit"
                  formAction={deleteVenue}
                  className="text-metadata font-semibold text-red-600 hover:underline"
                >
                  Delete Venue
                </button>
                <button type="submit" className="rounded-2xl bg-findmi px-5 py-2.5 text-button font-bold uppercase text-white transition hover:bg-findmi-600">
                  Save Venue
                </button>
              </div>
            </form>
          );
        })
      )}
    </div>
  );
}
