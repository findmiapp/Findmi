import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminOpportunityListing, getAdminOpportunityOptions } from "@/lib/opportunity-listings";
import { getEventOptionById, getLocationOptionById } from "@/lib/admin/queries";
import { isLegacyUnclassified } from "@/lib/opportunity-commercial-terms-bridge";
import OpportunityForm from "../../OpportunityForm";
import { saveOpportunity } from "../../actions";
import type { InitialOption } from "../../CommercialTermsBuilder";

export const dynamic = "force-dynamic";

/** Edit mode for one Opportunity — the existing OpportunityForm. Save
 * returns to the detail page; validation errors come back here. */
export default async function EditOpportunityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const result = await getAdminOpportunityListing(id);
  if (!result) notFound();
  const { listing } = result;
  const [initialLocation, initialEvent, options] = await Promise.all([
    getLocationOptionById(listing.location_id),
    getEventOptionById(listing.event_id),
    getAdminOpportunityOptions(listing.id),
  ]);
  const initialOptions: InitialOption[] = options.map((o) => ({
    id: o.id,
    name: o.name,
    description: o.description,
    commercial_mode: o.commercial_mode as InitialOption["commercial_mode"],
    custom_terms_note: o.custom_terms_note,
    components: o.components.map((c) => ({
      component_type: c.component_type as InitialOption["components"][number]["component_type"],
      amount_mode: c.amount_mode as InitialOption["components"][number]["amount_mode"],
      amount_min_cents: c.amount_min_cents,
      amount_max_cents: c.amount_max_cents,
      currency: c.currency,
      in_kind_category: c.in_kind_category as InitialOption["components"][number]["in_kind_category"],
      in_kind_description: c.in_kind_description,
      in_kind_provider: c.in_kind_provider as InitialOption["components"][number]["in_kind_provider"],
      in_kind_required: c.in_kind_required,
      estimated_value_cents: c.estimated_value_cents,
      quantity: c.quantity,
      unit: c.unit as InitialOption["components"][number]["unit"],
      custom_unit_label: c.custom_unit_label,
      unit_value_cents: c.unit_value_cents,
    })),
  }));
  const detailHref = `/admin/opportunities/${listing.id}`;

  return (
    <div>
      <div className="flex min-w-0 items-center gap-2 text-sm text-ink/45">
        <Link href="/admin/opportunities" className="shrink-0 hover:underline">
          Opportunities
        </Link>
        <span>/</span>
        <Link href={detailHref} className="truncate hover:underline">
          {listing.title}
        </Link>
      </div>
      <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">Edit Opportunity</h1>
      {error && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <div className="mt-5">
        <OpportunityForm
          listing={listing}
          initialOptions={initialOptions}
          legacyUnclassified={isLegacyUnclassified(options.length)}
          initialLocation={initialLocation}
          initialEvent={initialEvent}
          action={saveOpportunity.bind(null, listing.id)}
          saveLabel="Save Changes"
          cancelHref={detailHref}
        />
      </div>
    </div>
  );
}
