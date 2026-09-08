import { CheckboxField, NumberField, SelectField, TextField, TextareaField } from "@/components/admin/Fields";
import ImageField from "@/components/admin/ImageField";
import { RelationField } from "@/components/admin/RelationPicker";
import SubmitBar from "@/components/admin/SubmitBar";
import DeleteButton from "@/components/admin/DeleteButton";
import MarketAreaFields, { type MarketWithAreaOptions } from "@/components/MarketAreaFields";
import type { AdminAppearance, SelectOption } from "@/lib/admin/queries";
import { isoToLocalDateTime } from "@/lib/admin/form-helpers";
import { saveAppearance, deleteAppearance } from "./actions";
import AppearanceEventFields from "./AppearanceEventFields";

export default function AppearanceForm({
  appearance,
  initialBusiness,
  initialEvent,
  marketsWithAreas,
  error,
}: {
  appearance: AdminAppearance | null;
  initialBusiness: SelectOption | null;
  initialEvent: SelectOption | null;
  marketsWithAreas: MarketWithAreaOptions[];
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

        <AppearanceEventFields
          initialEvent={initialEvent}
          initialOccurrenceId={appearance?.event_occurrence_id ?? null}
          initialValues={{
            title: appearance?.title ?? "",
            start_local: isoToLocalDateTime(appearance?.start_at ?? null),
            end_local: isoToLocalDateTime(appearance?.end_at ?? null),
            venue_name: appearance?.venue_name ?? "",
            address: appearance?.address ?? "",
            city: appearance?.city ?? "",
            state: appearance?.state ?? "",
          }}
        />

        <div className="rounded-2xl border border-black/10 p-4">
          <p className="mb-1 text-sm font-semibold text-ink">Card Click Behavior</p>
          <p className="mb-3 text-xs text-ink/50">
            Click priority: Related Event → External Link → Flyer → Directions. Only the highest one set
            actually wins on the card — the others still save, they just won&rsquo;t be the click target.
          </p>
          <div className="flex flex-col gap-4">
            <TextField
              label="External Link (optional)"
              name="external_url"
              defaultValue={appearance?.external_url}
              placeholder="https://… or /a-findmi-page"
              hint="Used only when no Related Event is set above."
            />
            <ImageField label="Flyer / Image (optional)" name="flyer_image_url" defaultValue={appearance?.flyer_image_url} />
          </div>
        </div>

        <TextareaField label="Notes" name="description" defaultValue={appearance?.description} rows={3} />

        {/* Event + Appearance Geography Completion pass — Market/Area is
            FindMi DISCOVERY geography, its own section, never merged with
            Venue/Address/City/State above (PHYSICAL geography). Only
            takes effect for a STANDALONE appearance (no Related Event
            selected above) — an event-linked appearance always inherits
            its Event's geography instead (see saveAppearance/
            getFindMiHereFeed), so a selection made here is ignored (never
            silently stored where it could drift) once an Event is set. */}
        <div className="rounded-2xl border border-black/10 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Findmi Discovery Geography</p>
          <p className="mt-1 text-xs text-ink/50">
            Only used when no Related Findmi Event is set above — a linked appearance always inherits that Event&rsquo;s
            Market/Area instead.
          </p>
          <div className="mt-3">
            <MarketAreaFields
              markets={marketsWithAreas}
              defaultMarketId={appearance?.market_id ?? null}
              defaultAreaId={appearance?.market_area_id ?? null}
            />
          </div>
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
