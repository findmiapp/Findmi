import { notFound } from "next/navigation";
import { getAdminLocationById } from "@/lib/admin/queries";
import ViewPublicPageLink from "@/components/admin/ViewPublicPageLink";
import LocationForm from "../LocationForm";

export const dynamic = "force-dynamic";

export default async function EditLocationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { error, saved } = await searchParams;
  const location = await getAdminLocationById(id);
  if (!location) notFound();
  const publicHref = !location.is_demo ? `/location/${location.slug}` : null;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Edit Location</h1>
        <ViewPublicPageLink href={publicHref} />
      </div>
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved.
        </p>
      )}
      <div className="mt-5">
        <LocationForm location={location} error={error} />
      </div>
    </div>
  );
}
