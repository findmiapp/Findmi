import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getContact } from "@/lib/admin/bd/contacts";
import ContactForm from "../../ContactForm";
import { updateContact } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit Contact" };

export default async function EditBdContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const contact = await getContact(id);
  if (!contact) notFound();
  // The current Organization is kept even if it has since been archived —
  // shown honestly (sublabel) and never silently disconnected on save.
  const initialOrganization = contact.organization_id
    ? {
        value: contact.organization_id,
        label: contact.organization?.name ?? "Linked Organization",
        sublabel: contact.organization?.archived_at ? "Archived" : undefined,
        archived: Boolean(contact.organization?.archived_at),
      }
    : null;

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Edit Contact</h1>
      <p className="mt-1 text-sm text-ink/50">Private Business Development Contact.</p>
      <div className="mt-5">
        <ContactForm
          contact={{ name: contact.name, title: contact.title, email: contact.email, phone: contact.phone, notes: contact.notes }}
          initialOrganization={initialOrganization}
          action={updateContact.bind(null, contact.id)}
          saveLabel="Save"
          cancelHref={`/admin/bd/contacts/${contact.id}`}
        />
      </div>
    </div>
  );
}
