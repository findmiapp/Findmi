import { notFound } from "next/navigation";
import { getAdminEventById, getAllCategories, getEventCategoryIds } from "@/lib/admin/queries";
import ViewPublicPageLink from "@/components/admin/ViewPublicPageLink";
import EventForm from "../EventForm";

export const dynamic = "force-dynamic";

export default async function EditEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { error, saved } = await searchParams;
  const [result, categories, selectedCategoryIds] = await Promise.all([
    getAdminEventById(id),
    getAllCategories(),
    getEventCategoryIds(id),
  ]);
  if (!result) notFound();
  const publicHref = !result.event.is_demo ? `/event/${result.event.slug}` : null;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Edit Event</h1>
        <ViewPublicPageLink href={publicHref} />
      </div>
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved.
        </p>
      )}
      <div className="mt-5">
        <EventForm
          event={result.event}
          participants={result.participants}
          featuredProducts={result.featuredProducts}
          galleryImages={result.galleryImages}
          venueImages={result.venueImages}
          categories={categories}
          selectedCategoryIds={selectedCategoryIds}
          error={error}
        />
      </div>
    </div>
  );
}
