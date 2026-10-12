import type { Metadata } from "next";
import Link from "next/link";
import { getLinkedBusinesses, listOrganizations, ORGANIZATION_LIST_LIMIT } from "@/lib/admin/bd/organizations";
import { isOrganizationKind, ORGANIZATION_KINDS, ORGANIZATION_KIND_LABELS } from "@/lib/bd/domain";
import { ArchivedPill, LinkedBusinessPill, OrganizationKindPill, PrivateBadge } from "../BdPills";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Organizations" };

type Search = { q?: string; kind?: string; archived?: string };

function listHref(current: Search, patch: Partial<Search>): string {
  const next = { ...current, ...patch };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.kind) params.set("kind", next.kind);
  if (next.archived === "1") params.set("archived", "1");
  const qs = params.toString();
  return `/admin/bd/organizations${qs ? `?${qs}` : ""}`;
}

export default async function BdOrganizationsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const kind = isOrganizationKind(sp.kind) ? sp.kind : null;
  const archived = sp.archived === "1";
  const current: Search = { q, kind: kind ?? undefined, archived: archived ? "1" : undefined };

  const organizations = await listOrganizations({ q, kind, archived });
  const businesses = await getLinkedBusinesses(organizations.map((o) => o.business_id));
  const filtered = Boolean(q || kind);

  const chip = (active: boolean) =>
    `shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
      active ? "border-ink bg-ink text-white" : "border-black/10 bg-white text-ink/65 hover:border-black/20 hover:text-ink"
    }`;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Organizations</h1>
            <PrivateBadge />
          </div>
          <p className="mt-1 max-w-xl text-sm text-ink/50">Private Business Development records — not public Findmi Businesses.</p>
        </div>
        <Link
          href="/admin/bd/organizations/new"
          className="shrink-0 rounded-full bg-ink px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-ink/85"
        >
          + New Organization
        </Link>
      </div>

      <form method="get" className="mt-4 flex gap-2">
        {kind && <input type="hidden" name="kind" value={kind} />}
        {archived && <input type="hidden" name="archived" value="1" />}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search name or website…"
          aria-label="Search Organizations"
          className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none sm:max-w-xs"
        />
        <button type="submit" className="shrink-0 rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-black/[0.03]">
          Search
        </button>
      </form>

      <nav aria-label="Filter by kind" className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        <Link href={listHref(current, { kind: undefined })} aria-current={!kind ? "page" : undefined} className={chip(!kind)}>
          All Kinds
        </Link>
        {ORGANIZATION_KINDS.map((k) => (
          <Link key={k} href={listHref(current, { kind: k })} aria-current={kind === k ? "page" : undefined} className={chip(kind === k)}>
            {ORGANIZATION_KIND_LABELS[k]}
          </Link>
        ))}
      </nav>

      <nav aria-label="Filter by status" className="mt-2 flex gap-1.5">
        <Link href={listHref(current, { archived: undefined })} aria-current={!archived ? "page" : undefined} className={chip(!archived)}>
          Active
        </Link>
        <Link href={listHref(current, { archived: "1" })} aria-current={archived ? "page" : undefined} className={chip(archived)}>
          Archived
        </Link>
      </nav>

      <div className="mt-4 flex flex-col gap-2">
        {organizations.length === 0 && (
          <p className="rounded-xl border border-dashed border-black/15 px-4 py-6 text-center text-sm text-ink/45">
            {filtered
              ? "No Organizations match these filters."
              : archived
                ? "No archived Organizations."
                : "No Organizations yet."}
          </p>
        )}
        {organizations.map((o) => {
          const business = o.business_id ? businesses.get(o.business_id) : null;
          return (
            <Link
              key={o.id}
              href={`/admin/bd/organizations/${o.id}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-black/5 bg-white px-4 py-3 transition hover:border-black/10"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{o.name}</p>
                {(business || o.website) && (
                  <p className="truncate text-xs text-ink/50">{business ? `Findmi: ${business.name}` : o.website}</p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                <OrganizationKindPill kind={o.kind} />
                {o.business_id && <LinkedBusinessPill />}
                {o.archived_at && <ArchivedPill />}
              </div>
            </Link>
          );
        })}
        {organizations.length >= ORGANIZATION_LIST_LIMIT && (
          <p className="px-1 text-xs text-ink/45">Showing the first {ORGANIZATION_LIST_LIMIT}. Search to narrow the list.</p>
        )}
      </div>
    </div>
  );
}
