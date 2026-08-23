import Link from "next/link";
import { getAdminPeople } from "@/lib/admin/people-queries";

export const dynamic = "force-dynamic";

export default async function AdminPeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const people = await getAdminPeople({ q });

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">People</h1>
        <Link
          href="/admin/people/new"
          className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink hover:bg-findmi-600"
        >
          New Person
        </Link>
      </div>
      <p className="mt-1 text-sm text-ink/50">
        Founders, owners, makers, chefs, creators, operators — the people behind FindMi brands.
      </p>

      <form method="get" className="mt-4 flex gap-2">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search by name or bio…"
          className="w-full max-w-xs rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
        />
        <button type="submit" className="rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-black/[0.03]">
          Search
        </button>
      </form>

      <div className="mt-4 flex flex-col gap-2">
        {people.length === 0 ? (
          <p className="text-sm text-ink/50">No people yet.</p>
        ) : (
          people.map((p) => (
            <Link
              key={p.id}
              href={`/admin/people/${p.id}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-black/5 bg-white px-4 py-3 transition hover:border-black/10"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{p.name}</p>
                {p.location && <p className="truncate text-xs text-ink/50">{p.location}</p>}
              </div>
              <div className="flex shrink-0 gap-1.5">
                {p.is_featured && (
                  <span className="rounded-full bg-findmi-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-findmi-700">
                    Featured
                  </span>
                )}
                {!p.is_public && (
                  <span className="rounded-full bg-black/[0.06] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-ink/60">
                    Hidden
                  </span>
                )}
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
