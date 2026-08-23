import {
  CheckboxField,
  CheckboxList,
  DateTimeField,
  TextField,
  TextareaField,
} from "@/components/admin/Fields";
import ImageField from "@/components/admin/ImageField";
import SubmitBar from "@/components/admin/SubmitBar";
import type { AdminEvent, SelectOption } from "@/lib/admin/queries";
import { isoToLocalDateTime } from "@/lib/admin/form-helpers";
import { saveEvent } from "./actions";

export default function EventForm({
  event,
  businessOptions,
  selectedBusinessIds,
  error,
}: {
  event: AdminEvent | null;
  businessOptions: SelectOption[];
  selectedBusinessIds: string[];
  error?: string;
}) {
  const action = saveEvent.bind(null, event?.id ?? null);

  return (
    <form action={action} className="flex flex-col gap-5">
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <CheckboxField
        label="Published"
        name="published"
        defaultChecked={event ? !event.is_demo : true}
        hint="On = visible to the public. Off = hidden (demo/test only)."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Event Name" name="name" defaultValue={event?.name} required />
        <TextField
          label="URL Slug"
          name="slug"
          defaultValue={event?.slug}
          required
          hint="Used in the public URL: /event/your-slug"
        />
      </div>

      <TextareaField label="Description" name="description" defaultValue={event?.description} />
      <ImageField label="Cover Photo" name="cover_image_url" defaultValue={event?.cover_image_url} />

      <div className="grid gap-4 sm:grid-cols-2">
        <DateTimeField
          label="Start Date & Time"
          name="start_at"
          defaultValue={isoToLocalDateTime(event?.start_at ?? null)}
          required
          hint="Eastern time (America/New_York)."
        />
        <DateTimeField
          label="End Date & Time"
          name="end_at"
          defaultValue={isoToLocalDateTime(event?.end_at ?? null)}
          hint="Optional. Also Eastern time."
        />
      </div>

      <TextField label="Venue Name" name="venue_name" defaultValue={event?.venue_name} />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label="Address" name="address" defaultValue={event?.address} />
        <TextField label="City" name="city" defaultValue={event?.city} />
        <TextField label="State" name="state" defaultValue={event?.state} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Organizer Name"
          name="organizer_name"
          defaultValue={event?.organizer_name}
        />
        <TextField
          label="External Event Link"
          name="external_url"
          type="url"
          defaultValue={event?.external_url}
          placeholder="https://…"
        />
      </div>

      <CheckboxField
        label="Featured"
        name="is_featured"
        defaultChecked={event?.is_featured}
        hint="Gives this event priority in featured lists."
      />

      <CheckboxList
        label="Participating Businesses"
        name="business_ids"
        defaultSelected={selectedBusinessIds}
        options={businessOptions}
        emptyText="No businesses yet — add one first."
      />

      <SubmitBar cancelHref="/admin/events" />
    </form>
  );
}
