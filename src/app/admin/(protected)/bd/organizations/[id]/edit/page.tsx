import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLinkedBusinesses, getOrganization } from "@/lib/admin/bd/organizations";
import OrganizationForm from "../../OrganizationForm";
import { updateOrganization } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit Organization" };

export default async function EditBdOrganizationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const organization = await getOrganization(id);
  if (!organization) notFound();
  const business = organization.business_id ? ((await getLinkedBusinesses([organization.business_id])).get(organization.business_id) ?? null) : null;
  const initialBusiness = business
    ? {
        value: business.id,
        label: business.name,
        sublabel: [business.city, business.state].filter(Boolean).join(", ") || undefined,
        image_url: business.logo_url,
      }
    : organization.business_id
      ? // Linked, but the Business couldn't be read right now: keep the
        // existing link rather than silently unlinking it on save.
        { value: organization.business_id, label: "Linked Findmi Business" }
      : null;

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Edit Organization</h1>
      <p className="mt-1 text-sm text-ink/50">Private Business Development record.</p>
      <div className="mt-5">
        <OrganizationForm
          organization={{ name: organization.name, kind: organization.kind, website: organization.website, notes: organization.notes }}
          initialBusiness={initialBusiness}
          action={updateOrganization.bind(null, organization.id)}
          saveLabel="Save"
          cancelHref={`/admin/bd/organizations/${organization.id}`}
        />
      </div>
    </div>
  );
}
