import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getContact } from "@/lib/admin/bd/contacts";
import ConfirmSubmitButton from "../../../opportunities/ConfirmSubmitButton";
import { ArchivedPill, PrivateBadge } from "../../BdPills";
import { archiveContact, restoreContact } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contact" };

const when = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });

export default async function BdContactPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; archived?: string; restored?: string; error?: string }>;
}) {
  const { id } = await params;
  const { saved, archived, restored, error } = await searchParams;
  const contact = await getContact(id);
  if (!contact) notFound();
  const isArchived = Boolean(contact.archived_at);
  const notice = error ? null : saved ? "Saved." : archived ? "Archived." : restored ? "Restored." : null;
  const organization = contact.organization;

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <PrivateBadge />
            {isArchived && <ArchivedPill />}
          </div>
          <h1 className="mt-2 break-words font-display text-2xl font-semibold tracking-tight text-ink">{contact.name}</h1>
          <p className="mt-0.5 break-words text-sm text-ink/55">{contact.title ?? "Private Business Development Contact"}</p>
        </div>
        <Link
          href={`/admin/bd/contacts/${contact.id}/edit`}
          className="shrink-0 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink transition hover:border-black/20"
        >
          Edit
        </Link>
      </div>

      {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {notice && <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">{notice}</p>}
      {isArchived && (
        <p className="mt-4 rounded-xl border border-black/10 bg-black/[0.03] px-4 py-3 text-sm text-ink/65">
          Archived {when(contact.archived_at!)} — hidden from the default list. It can still be edited or restored.
        </p>
      )}

      <section className="mt-6 rounded-2xl border border-black/[0.07] bg-white p-4">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs font-medium text-ink/45">Email</dt>
            <dd className="mt-0.5 break-all text-sm text-ink">
              {contact.email ? (
                <a href={`mailto:${contact.email}`} className="text-findmi-700 underline-offset-2 hover:underline">
                  {contact.email}
                </a>
              ) : (
                <span className="text-ink/40">Not set</span>
              )}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-medium text-ink/45">Phone</dt>
            <dd className="mt-0.5 break-all text-sm text-ink">
              {contact.phone ? (
                <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} className="text-findmi-700 underline-offset-2 hover:underline">
                  {contact.phone}
                </a>
              ) : (
                <span className="text-ink/40">Not set</span>
              )}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium text-ink/45">Private Notes</dt>
            <dd className="mt-0.5 whitespace-pre-line break-words text-sm leading-relaxed text-ink">
              {contact.notes ?? <span className="text-ink/40">None</span>}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium text-ink/45">Record</dt>
            <dd className="mt-0.5 text-sm text-ink/70">
              Created {when(contact.created_at)} · Updated {when(contact.updated_at)}
            </dd>
          </div>
        </dl>
      </section>

      <section className="mt-4">
        <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-ink/45">Organization</h2>
        {organization ? (
          <Link
            href={`/admin/bd/organizations/${organization.id}`}
            className="mt-2 flex items-center justify-between gap-3 rounded-2xl border border-black/[0.07] bg-white p-3 transition hover:border-black/15"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink">{organization.name}</span>
              <span className="block text-xs text-ink/50">Private BD Organization</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {organization.archived_at && <ArchivedPill />}
              <span aria-hidden="true" className="text-ink/30">›</span>
            </span>
          </Link>
        ) : (
          <p className="mt-2 rounded-2xl border border-dashed border-black/15 px-4 py-4 text-sm text-ink/45">Not linked to an Organization.</p>
        )}
      </section>

      <div className="mt-8 border-t border-black/5 pt-5">
        {isArchived ? (
          <ConfirmSubmitButton
            action={restoreContact.bind(null, contact.id)}
            confirmMessage={`Restore "${contact.name}" to the active list?`}
            label="Restore"
            className="min-h-[44px] rounded-full border border-findmi/30 bg-findmi-50 px-5 text-xs font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-findmi-100"
          />
        ) : (
          <ConfirmSubmitButton
            action={archiveContact.bind(null, contact.id)}
            confirmMessage={`Archive "${contact.name}"? They will be hidden from the default list but nothing is deleted, and they can be restored.`}
            label="Archive"
            className="min-h-[44px] rounded-full border border-black/15 px-5 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:bg-black/[0.03]"
          />
        )}
      </div>
    </div>
  );
}
