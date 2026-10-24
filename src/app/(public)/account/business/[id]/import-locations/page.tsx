import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { errorRedirectUrl } from "@/lib/admin/form-helpers";
import { requireBusinessMember } from "@/lib/permissions";
import { isManagingRole } from "@/lib/business-locations";
import { getProductSets } from "@/lib/business-product-sets";
import { getResumableImport, importAvailable } from "@/lib/locator-import/server";
import ChevronIcon from "@/components/ChevronIcon";
import ImportLocationsWizard from "./ImportLocationsWizard";
import { IMPORT_TARGET_LABELS, importTargetFromParam } from "@/lib/locator-import/fields";

export const dynamic = "force-dynamic";

/** Import Locations — bring a list of places (CSV) into Findmi Here → Places,
 * into the relationship it was started from: Find Us Here (default) or Our
 * Locations (`?target=our-locations`). Owner / manager only. Reads the
 * Business's own Products and Product Sets so a Find Us Here import can
 * attach them; everything else happens through the actions. A resumed batch
 * keeps the target it was started with. */
export default async function ImportLocationsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ batch?: string; target?: string }> }) {
  const { id } = await params;
  const { batch: batchParam, target: targetParam } = await searchParams;
  let allowed = false;
  try {
    const membership = await requireBusinessMember(id);
    allowed = Boolean(membership.viaAdmin) || isManagingRole(membership.role);
  } catch (err) {
    redirect(errorRedirectUrl("/account", err instanceof Error ? err.message : "You don't have access to this business."));
  }
  const admin = getAdminSupabase();
  if (!admin) redirect(errorRedirectUrl(`/account/business/${id}`, "Server isn't configured."));
  if (!allowed) redirect(errorRedirectUrl(`/account/business/${id}`, "Only a Business owner or manager can import locations."));

  const [{ data: business }, { data: products }, productSets, available, resume] = await Promise.all([
    admin.from("businesses").select("name").eq("id", id).maybeSingle(),
    admin.from("products").select("id, name").eq("business_id", id).is("archived_at", null).is("trashed_at", null).order("name").limit(300),
    getProductSets(admin, id),
    importAvailable(admin),
    batchParam ? getResumableImport(admin, id, batchParam) : Promise.resolve(null),
  ]);
  if (!business) redirect(errorRedirectUrl("/account", "Business not found."));
  const target = resume?.target ?? importTargetFromParam(targetParam);
  const operated = target === "our_locations";
  const home = `/account/business/${id}?tab=findmi-here&view=${operated ? "locations" : "find-us"}`;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
      <Link href={home} className="flex w-fit items-center gap-1 text-metadata font-semibold text-muted hover:text-secondary">
        <ChevronIcon direction="left" className="h-3 w-3" />
        {business.name}
      </Link>
      <div>
        <h1 className="font-display text-section-title font-bold text-primary">Import Locations</h1>
        <p className="mt-0.5 text-label font-bold uppercase text-findmi-700">Into {IMPORT_TARGET_LABELS[target]}</p>
        <p className="mt-1 text-body text-muted">
          {operated
            ? "Upload a list of the places your Business owns or operates. Findmi matches each one to a Location that’s already here before it adds anything new, and you review it all first."
            : "Upload a list of the places you’re found. Findmi matches each one to a Location that’s already here before it adds anything new, and you review it all first."}
        </p>
        <Link href={`/account/business/${id}/import-locations/history`} className="mt-2 inline-block text-metadata font-semibold text-accent hover:underline">
          Import History
        </Link>
      </div>
      {available ? (
        <ImportLocationsWizard
          businessId={id}
          homeHref={home}
          products={(products ?? []) as { id: string; name: string }[]}
          productSets={productSets.sets}
          productSetsAvailable={productSets.available}
          resume={resume}
          target={target}
        />
      ) : (
        <p role="status" className="rounded-xl bg-black/[0.03] p-4 text-body text-muted">Importing locations isn’t available yet. Please check back soon.</p>
      )}
    </div>
  );
}
