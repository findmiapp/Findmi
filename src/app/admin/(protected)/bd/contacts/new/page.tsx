import type { Metadata } from "next";
import { getOrganization } from "@/lib/admin/bd/organizations";
import { isUuid } from "@/lib/bd/domain";
import ContactForm from "../ContactForm";
import { createContact } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New Contact" };

/** `?organization=<id>` (from an Organization's "Add Contact") preselects
 * that private Organization — only when it exists and isn't archived. */
export default async function NewBdContactPage({ searchParams }: { searchParams: Promise<{ organization?: string }> }) {
  const { organization: organizationParam } = await searchParams;
  const organization = isUuid(organizationParam) ? await getOrganization(organizationParam) : null;
  const prefill = organization && !organization.archived_at ? organization : null;

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">New Contact</h1>
      <p className="mt-1 max-w-xl text-sm text-ink/50">A private Business Development Contact. Never shown on public Findmi.</p>
      {organization?.archived_at && (
        <p className="mt-4 rounded-xl border border-black/10 bg-black/[0.03] px-4 py-3 text-sm text-ink/65">
          “{organization.name}” is archived, so it wasn&apos;t preselected. Restore it first to add Contacts to it.
        </p>
      )}
      <div className="mt-5">
        <ContactForm
          contact={null}
          initialOrganization={prefill ? { value: prefill.id, label: prefill.name } : null}
          action={createContact}
          saveLabel="Create"
          cancelHref={prefill ? `/admin/bd/organizations/${prefill.id}` : "/admin/bd/contacts"}
        />
      </div>
    </div>
  );
}
