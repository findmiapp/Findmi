import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { errorRedirectUrl } from "@/lib/admin/form-helpers";
import { requireBusinessMember } from "@/lib/permissions";
import { parseEventImportIntent } from "@/lib/event-import/types";
import ChevronIcon from "@/components/ChevronIcon";
import EventImporter from "./EventImporter";

export const dynamic = "force-dynamic";

/** Event Import V1 — Business entry. `?intent=participating` comes from
 * Where I'll Be, `?intent=hosting` from Host an Event; without one the
 * importer asks how the Business is involved. The same importer can be
 * opened from anywhere (e.g. right after Business creation) with just the
 * Business id + an intent. */
export default async function ImportEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ intent?: string }>;
}) {
  const { id } = await params;
  const { intent: intentParam } = await searchParams;

  try {
    await requireBusinessMember(id);
  } catch (err) {
    redirect(errorRedirectUrl("/account", err instanceof Error ? err.message : "You don't have access to this business."));
  }
  const admin = getAdminSupabase();
  if (!admin) redirect(errorRedirectUrl(`/account/business/${id}`, "Server isn't configured."));
  const { data: business } = await admin.from("businesses").select("name").eq("id", id).maybeSingle();
  if (!business) redirect(errorRedirectUrl("/account", "Business not found."));

  const intent = parseEventImportIntent(intentParam);
  const businessHome = `/account/business/${id}`;

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-6">
      <Link href={businessHome} className="flex w-fit items-center gap-1 text-metadata font-semibold text-muted hover:text-secondary">
        <ChevronIcon direction="left" className="h-3 w-3" />
        {business.name}
      </Link>
      <EventImporter
        businessId={id}
        businessName={business.name}
        initialIntent={intent}
        manualHrefs={{
          participating: `${businessHome}?tab=findmi-here&compose=1#going-somewhere`,
          hosting: `/account/event/new?business_id=${encodeURIComponent(id)}`,
        }}
        businessHome={businessHome}
      />
    </div>
  );
}
