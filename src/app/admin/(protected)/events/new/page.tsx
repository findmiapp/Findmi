import { getAdminLocations, getAllCategories } from "@/lib/admin/queries";
import EventForm from "../EventForm";

export const dynamic = "force-dynamic";

export default async function NewEventPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const [categories, locations] = await Promise.all([getAllCategories("event"), getAdminLocations()]);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Add Event</h1>
      <div className="mt-5">
        <EventForm
          event={null}
          participants={[]}
          featuredProducts={[]}
          galleryImages={[]}
          venueImages={[]}
          occurrences={[]}
          vendorRostersByOccurrence={{}}
          locations={locations}
          categories={categories}
          selectedCategoryIds={[]}
          error={error}
        />
      </div>
    </div>
  );
}
