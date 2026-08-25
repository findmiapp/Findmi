import {
  CheckboxField,
  CheckboxList,
  DateTimeField,
  NumberField,
  TextField,
  TextareaField,
} from "@/components/admin/Fields";
import ImageField from "@/components/admin/ImageField";
import SubmitBar from "@/components/admin/SubmitBar";
import ParticipationRoster from "@/components/admin/ParticipationRoster";
import EventProductsRoster from "@/components/admin/EventProductsRoster";
import type { AdminEvent, EventFeaturedProduct, EventParticipant } from "@/lib/admin/queries";
import type { Category } from "@/lib/types";
import { isoToLocalDateTime } from "@/lib/admin/form-helpers";
import { saveEvent } from "./actions";

export default function EventForm({
  event,
  participants,
  featuredProducts,
  categories,
  selectedCategoryIds,
  error,
}: {
  event: AdminEvent | null;
  participants: EventParticipant[];
  featuredProducts: EventFeaturedProduct[];
  categories: Category[];
  selectedCategoryIds: string[];
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
          hint="Shown as a plain 'Event Details' link — always visible when set."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <CheckboxField
          label="Featured"
          name="is_featured"
          defaultChecked={event?.is_featured}
          hint="Gives this event priority in featured lists."
        />
        <NumberField
          label="Featured Order"
          name="featured_sort_order"
          defaultValue={event?.featured_sort_order ?? undefined}
          hint="Only matters when Featured is on — lower numbers show first."
        />
      </div>

      <CheckboxList
        label="Categories / Experience"
        name="category_ids"
        defaultSelected={selectedCategoryIds}
        options={categories.map((c) => ({ value: c.id, label: c.name }))}
        emptyText="No categories yet — add some in /admin/categories."
      />

      {/* --- Consumer actions --- each toggle only ever shows on the public
          page when it's on AND has a real destination. */}
      <div className="rounded-2xl border border-black/10 p-4">
        <p className="mb-3 text-sm font-semibold text-ink">Event Actions</p>
        <div className="flex flex-col gap-4">
          <div>
            <CheckboxField
              label="Get Directions"
              name="directions_enabled"
              defaultChecked={event ? event.directions_enabled : true}
              hint="Derived automatically from the venue/address above — no link to enter."
            />
          </div>

          <div className="flex flex-col gap-2">
            <CheckboxField
              label="RSVP"
              name="rsvp_enabled"
              defaultChecked={event?.rsvp_enabled}
            />
            <TextField label="RSVP Link" name="rsvp_url" type="url" defaultValue={event?.rsvp_url} placeholder="https://…" />
          </div>

          <div className="flex flex-col gap-2">
            <CheckboxField
              label="Tickets"
              name="tickets_enabled"
              defaultChecked={event?.tickets_enabled}
            />
            <TextField label="Ticket Link" name="tickets_url" type="url" defaultValue={event?.tickets_url} placeholder="https://…" />
          </div>

          <div className="flex flex-col gap-2">
            <CheckboxField
              label="Vendor Applications"
              name="vendor_applications_enabled"
              defaultChecked={event?.vendor_applications_enabled}
              hint="Shows 'Apply to Vend' — opens an external application form."
            />
            <TextField
              label="Application Link"
              name="vendor_application_url"
              type="url"
              defaultValue={event?.vendor_application_url}
              placeholder="https://…"
            />
            <DateTimeField
              label="Application Deadline"
              name="vendor_application_deadline"
              defaultValue={isoToLocalDateTime(event?.vendor_application_deadline ?? null)}
              hint="Optional. After this, 'Apply to Vend' stops showing even if still enabled."
            />
          </div>

          <div className="flex flex-col gap-2">
            <CheckboxField
              label="Contact Organizer"
              name="contact_enabled"
              defaultChecked={event?.contact_enabled}
            />
            <TextField
              label="Organizer Email"
              name="organizer_email"
              type="email"
              defaultValue={event?.organizer_email}
              placeholder="organizer@email.com"
            />
            <TextField
              label="Or Contact Link"
              name="contact_url"
              type="url"
              defaultValue={event?.contact_url}
              placeholder="https://…"
              hint="Used instead of email if both are set."
            />
          </div>

          <div>
            <CheckboxField
              label="Follow"
              name="follow_enabled"
              defaultChecked={event?.follow_enabled}
              hint="Lets consumers leave their email for updates about this event."
            />
          </div>
        </div>
      </div>

      <ParticipationRoster initialParticipants={participants} />

      <div className="rounded-2xl border border-black/10 p-4">
        <TextField
          label="Featured Products Heading"
          name="featured_products_heading"
          defaultValue={event?.featured_products_heading}
          placeholder="Featured at This Event"
          hint="Optional — defaults to “Featured at This Event” when blank."
        />
        <div className="mt-4">
          <EventProductsRoster initialProducts={featuredProducts} />
        </div>
      </div>

      <SubmitBar cancelHref="/admin/events" />
    </form>
  );
}
