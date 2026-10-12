import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_LIST_LIMIT, listContacts } from "@/lib/admin/bd/contacts";
import { getOrganization } from "@/lib/admin/bd/organizations";
import { isUuid } from "@/lib/bd/domain";
import { PrivateBadge } from "../BdPills";
import ContactRow from "./ContactRow";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contacts" };

type Search = { q?: string; organization?: string; archived?: string };

function listHref(current: Search, patch: Partial<Search>): string {
  const next = { ...current, ...patch };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.organization) params.set("organization", next.organization);
  if (next.archived === "1") params.set("archived", "1");
  const qs = params.toString();
  return `/admin/bd/contacts${qs ? `?${qs}` : ""}`;
}

export default async function BdContactsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const organizationId = isUuid(sp.organization) ? sp.organization : null;
  const archived = sp.archived === "1";
  const current: Search = { q, organization: organizationId ?? undefined, archived: archived ? "1" : undefined };

  const [contacts, organization] = await Promise.all([
    listContacts({ q, organizationId, archived }),
    organizationId ? getOrganization(organizationId) : Promise.resolve(null),
  ]);
  const filtered = Boolean(q || organizationId);

  const chip = (active: boolean) =>
    `shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
      active ? "border-ink bg-ink text-white" : "border-black/10 bg-white text-ink/65 hover:border-black/20 hover:text-ink"
    }`;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Contacts</h1>
            <PrivateBadge />
          </div>
          <p className="mt-1 max-w-xl text-sm text-ink/50">People Findmi knows at private BD Organizations. Never shown on public Findmi.</p>
        </div>
        <Link
          href={organizationId ? `/admin/bd/contacts/new?organization=${organizationId}` : "/admin/bd/contacts/new"}
          className="shrink-0 rounded-full bg-ink px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-ink/85"
        >
          + New Contact
        </Link>
      </div>

      <form method="get" className="mt-4 flex gap-2">
        {organizationId && <input type="hidden" name="organization" value={organizationId} />}
        {archived && <input type="hidden" name="archived" value="1" />}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search name, email or title…"
          aria-label="Search Contacts"
          className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none sm:max-w-xs"
        />
        <button type="submit" className="shrink-0 rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-black/[0.03]">
          Search
        </button>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <nav aria-label="Filter by status" className="flex gap-1.5">
          <Link href={listHref(current, { archived: undefined })} aria-current={!archived ? "page" : undefined} className={chip(!archived)}>
            Active
          </Link>
          <Link href={listHref(current, { archived: "1" })} aria-current={archived ? "page" : undefined} className={chip(archived)}>
            Archived
          </Link>
        </nav>
        {organizationId && (
          <Link
            href={listHref(current, { organization: undefined })}
            aria-label="Clear Organization filter"
            className="flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-findmi/30 bg-findmi-50 px-3.5 py-1.5 text-xs font-semibold text-findmi-700"
          >
            <span className="truncate">Organization: {organization?.name ?? "Unknown"}</span>
            <span aria-hidden="true">×</span>
          </Link>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {contacts.length === 0 && (
          <p className="rounded-xl border border-dashed border-black/15 px-4 py-6 text-center text-sm text-ink/45">
            {filtered ? "No Contacts match these filters." : archived ? "No archived Contacts." : "No Contacts yet."}
          </p>
        )}
        {contacts.map((c) => (
          <ContactRow key={c.id} contact={c} showOrganization={!organizationId} />
        ))}
        {contacts.length >= CONTACT_LIST_LIMIT && (
          <p className="px-1 text-xs text-ink/45">Showing the first {CONTACT_LIST_LIMIT}. Search to narrow the list.</p>
        )}
      </div>
    </div>
  );
}
