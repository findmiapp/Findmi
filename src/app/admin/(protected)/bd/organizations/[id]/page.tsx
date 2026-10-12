import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLinkedBusinesses, getOrganization } from "@/lib/admin/bd/organizations";
import ConfirmSubmitButton from "../../../opportunities/ConfirmSubmitButton";
import { ArchivedPill, OrganizationKindPill, PrivateBadge } from "../../BdPills";
import { archiveOrganization, restoreOrganization } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Organization" };

const when = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });

export default async function BdOrganizationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; archived?: string; restored?: string; error?: string }>;
}) {
  const { id } = await params;
  const { saved, archived, restored, error } = await searchParams;
  const organization = await getOrganization(id);
  if (!organization) notFound();
  const business = organization.business_id ? ((await getLinkedBusinesses([organization.business_id])).get(organization.business_id) ?? null) : null;
  const isArchived = Boolean(organization.archived_at);
  const notice = error ? null : saved ? "Saved." : archived ? "Archived." : restored ? "Restored." : null;
  const websiteHref = organization.website && /^https?:\/\//i.test(organization.website) ? organization.website : null;

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <PrivateBadge />
            <OrganizationKindPill kind={organization.kind} />
            {isArchived && <ArchivedPill />}
          </div>
          <h1 className="mt-2 break-words font-display text-2xl font-semibold tracking-tight text-ink">{organization.name}</h1>
          <p className="mt-0.5 text-xs text-ink/45">Private Business Development Organization</p>
        </div>
        <Link
          href={`/admin/bd/organizations/${organization.id}/edit`}
          className="shrink-0 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink transition hover:border-black/20"
        >
          Edit
        </Link>
      </div>

      {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {notice && <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">{notice}</p>}
      {isArchived && (
        <p className="mt-4 rounded-xl border border-black/10 bg-black/[0.03] px-4 py-3 text-sm text-ink/65">
          Archived {when(organization.archived_at!)} — hidden from the default list. It can still be edited or restored.
        </p>
      )}

      <section className="mt-6 rounded-2xl border border-black/[0.07] bg-white p-4">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs font-medium text-ink/45">Website</dt>
            <dd className="mt-0.5 truncate text-sm text-ink">
              {websiteHref ? (
                <a href={websiteHref} target="_blank" rel="noopener noreferrer" className="text-findmi-700 underline-offset-2 hover:underline">
                  {organization.website}
                </a>
              ) : (
                (organization.website ?? <span className="text-ink/40">Not set</span>)
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-ink/45">Record</dt>
            <dd className="mt-0.5 text-sm text-ink/70">
              Created {when(organization.created_at)} · Updated {when(organization.updated_at)}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium text-ink/45">Private Notes</dt>
            <dd className="mt-0.5 whitespace-pre-line break-words text-sm leading-relaxed text-ink">
              {organization.notes ?? <span className="text-ink/40">None</span>}
            </dd>
          </div>
        </dl>
      </section>

      <section className="mt-4">
        <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-ink/45">Linked Findmi Business</h2>
        {business ? (
          <div className="mt-2 flex items-center gap-3 rounded-2xl border border-black/[0.07] bg-white p-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-black/5 text-sm font-bold text-ink/40">
              {business.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={business.logo_url} alt="" className="h-full w-full object-cover" />
              ) : (
                business.name.charAt(0).toUpperCase()
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{business.name}</p>
              <p className="truncate text-xs text-ink/50">
                Public Findmi Business{[business.city, business.state].filter(Boolean).length ? ` · ${[business.city, business.state].filter(Boolean).join(", ")}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
              <Link href={`/admin/businesses/${business.id}`} className="text-xs font-semibold text-findmi-700 hover:underline">
                Admin
              </Link>
              <Link href={`/business/${business.slug}`} target="_blank" className="text-xs font-semibold text-findmi-700 hover:underline">
                Public Page
              </Link>
            </div>
          </div>
        ) : (
          <p className="mt-2 rounded-2xl border border-dashed border-black/15 px-4 py-4 text-sm text-ink/45">
            {organization.business_id ? "The linked Business could not be loaded." : "Not linked to a public Findmi Business."}
          </p>
        )}
      </section>

      <div className="mt-8 border-t border-black/5 pt-5">
        {isArchived ? (
          <ConfirmSubmitButton
            action={restoreOrganization.bind(null, organization.id)}
            confirmMessage={`Restore "${organization.name}" to the active list?`}
            label="Restore"
            className="min-h-[44px] rounded-full border border-findmi/30 bg-findmi-50 px-5 text-xs font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-findmi-100"
          />
        ) : (
          <ConfirmSubmitButton
            action={archiveOrganization.bind(null, organization.id)}
            confirmMessage={`Archive "${organization.name}"? It will be hidden from the default list but nothing is deleted, and it can be restored.`}
            label="Archive"
            className="min-h-[44px] rounded-full border border-black/15 px-5 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:bg-black/[0.03]"
          />
        )}
      </div>
    </div>
  );
}
