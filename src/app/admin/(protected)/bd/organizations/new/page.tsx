import type { Metadata } from "next";
import OrganizationForm from "../OrganizationForm";
import { createOrganization } from "../actions";

export const metadata: Metadata = { title: "New Organization" };

export default function NewBdOrganizationPage() {
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">New Organization</h1>
      <p className="mt-1 max-w-xl text-sm text-ink/50">A private Business Development record. This does not create a public Findmi Business.</p>
      <div className="mt-5">
        <OrganizationForm organization={null} initialBusiness={null} action={createOrganization} saveLabel="Create" cancelHref="/admin/bd/organizations" />
      </div>
    </div>
  );
}
