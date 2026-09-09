import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminLocationById, getAllCategories } from "@/lib/admin/queries";
import { getActiveMarketsWithAreaOptions } from "@/lib/admin/market-areas";
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
  const [location, marketsWithAreas, categories] = await Promise.all([
    getAdminLocationById(id),
    getActiveMarketsWithAreaOptions(),
    getAllCategories("location"),
  ]);
  if (!location) notFound();
  const publicHref = !location.is_demo ? `/location/${location.slug}` : null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Edit Location</h1>
        <div className="flex items-center gap-3">
          {/* Admin Manage-As — opens the exact same owner-facing Location
              Manager, with the founder's own admin session granting
              elevated access there (see lib/permissions.ts) — never
              impersonation, never a fabricated location_members row. */}
          <Link
            href={`/account/location/${id}`}
            className="inline-flex items-center gap-1 text-xs font-semibold text-findmi-700 hover:underline"
          >
            Open Location Manager <span aria-hidden="true">↗</span>
          </Link>
          <ViewPublicPageLink href={publicHref} />
        </div>
      </div>
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved.
        </p>
      )}
      <div className="mt-5">
        <LocationForm location={location} marketsWithAreas={marketsWithAreas} categories={categories} error={error} />
      </div>
    </div>
  );
}
