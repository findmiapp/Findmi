import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { errorRedirectUrl } from "@/lib/admin/form-helpers";
import { requireBusinessMember } from "@/lib/permissions";
import { isManagingRole } from "@/lib/business-locations";
import { getProductSets } from "@/lib/business-product-sets";
import { importAvailable } from "@/lib/locator-import/server";
import ChevronIcon from "@/components/ChevronIcon";
import ImportLocationsWizard from "./ImportLocationsWizard";

export const dynamic = "force-dynamic";

/** Import Locations — bring a store-locator list (CSV) into Find Us Here.
 * Owner / manager only. Reads the Business's own Products and Product Sets so
 * the import can attach them; everything else happens through the actions. */
export default async function ImportLocationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  const [{ data: business }, { data: products }, productSets, available] = await Promise.all([
    admin.from("businesses").select("name").eq("id", id).maybeSingle(),
    admin.from("products").select("id, name").eq("business_id", id).is("archived_at", null).is("trashed_at", null).order("name").limit(300),
    getProductSets(admin, id),
    importAvailable(admin),
  ]);
  if (!business) redirect(errorRedirectUrl("/account", "Business not found."));
  const home = `/account/business/${id}?tab=findmi-here`;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
      <Link href={home} className="flex w-fit items-center gap-1 text-metadata font-semibold text-muted hover:text-secondary">
        <ChevronIcon direction="left" className="h-3 w-3" />
        {business.name}
      </Link>
      <div>
        <h1 className="font-display text-section-title font-bold text-primary">Import Locations</h1>
        <p className="mt-1 text-body text-muted">Upload a list of the places you’re found. Findmi matches each one to a Location that’s already here before it adds anything new, and you review it all first.</p>
      </div>
      {available ? (
        <ImportLocationsWizard
          businessId={id}
          homeHref={home}
          products={(products ?? []) as { id: string; name: string }[]}
          productSets={productSets.sets}
          productSetsAvailable={productSets.available}
        />
      ) : (
        <p role="status" className="rounded-xl bg-black/[0.03] p-4 text-body text-muted">Importing locations isn’t available yet. Please check back soon.</p>
      )}
    </div>
  );
}
