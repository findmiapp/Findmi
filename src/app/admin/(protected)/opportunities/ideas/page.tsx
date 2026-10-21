import Link from "next/link";
import { getAdminIdeas } from "@/lib/brand-audit";
import { IDEA_AUDIENCE_LABELS, IDEA_STATUSES, IDEA_STATUS_LABELS, IDEA_TYPE_LABELS, isIdeaStatus, type IdeaStatus } from "@/lib/brand-audit-domain";
import OpportunitiesAdminTabs from "../OpportunitiesAdminTabs";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<IdeaStatus, string> = {
  published: "bg-findmi-50 text-findmi-700",
  draft: "bg-amber-50 text-amber-700",
  archived: "bg-black/5 text-ink/45",
};

/** Admin → Opportunities → Ideas — the Opportunity Idea library (strategy /
 * channel ideas Brands respond to; not real Opportunities or inventory),
 * with response counts. */
export default async function AdminIdeasPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: statusParam } = await searchParams;
  const status = isIdeaStatus(statusParam) ? statusParam : undefined;
  const { available, ideas } = await getAdminIdeas(status);
  const filters: { value?: IdeaStatus; label: string }[] = [{ label: "All" }, ...IDEA_STATUSES.map((s) => ({ value: s, label: IDEA_STATUS_LABELS[s] }))];

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Opportunities</h1>
          <p className="mt-1 max-w-xl text-sm text-ink/50">Ideas Findmi introduces to Brands to learn what they&rsquo;d be open to.</p>
        </div>
        {available && (
          <Link href="/admin/opportunities/ideas/new" className="flex h-10 items-center rounded-xl bg-ink px-4 text-sm font-semibold text-white hover:bg-ink/85">
            + New Idea
          </Link>
        )}
      </div>
      <OpportunitiesAdminTabs active="ideas" />

      {!available ? (
        <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Opportunity Ideas aren&rsquo;t available yet — the Growth Setup + Opportunity Ideas migration hasn&rsquo;t been applied to this database.
        </p>
      ) : (
        <>
          <nav aria-label="Filter by status" className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
            {filters.map((f) => {
              const active = f.value === status;
              return (
                <Link
                  key={f.label}
                  href={f.value ? `/admin/opportunities/ideas?status=${f.value}` : "/admin/opportunities/ideas"}
                  aria-current={active ? "page" : undefined}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${active ? "bg-ink text-white" : "bg-black/5 text-ink/60 hover:bg-black/10"}`}
                >
                  {f.label}
                </Link>
              );
            })}
          </nav>
          {ideas.length === 0 ? (
            <p className="mt-6 text-sm text-ink/50">No Ideas here yet.</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-2">
              {ideas.map((i) => (
                <li key={i.id}>
                  <Link href={`/admin/opportunities/ideas/${i.id}`} className="block rounded-xl border border-black/5 bg-white px-4 py-3.5 transition hover:border-black/15">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-bold uppercase tracking-wide text-ink/40">
                          {IDEA_TYPE_LABELS[i.idea_type]} · #{i.display_order} · {IDEA_AUDIENCE_LABELS[i.audience]}
                        </p>
                        <p className="mt-0.5 text-sm font-semibold text-ink">{i.title}</p>
                        <p className="mt-0.5 line-clamp-2 text-sm text-ink/55">{i.summary}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_TONE[i.status]}`}>{IDEA_STATUS_LABELS[i.status]}</span>
                    </div>
                    <p className="mt-2 text-xs font-semibold text-ink/55">
                      Interested {i.counts.interested} · Maybe {i.counts.maybe} · Not For Us {i.counts.not_for_us}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
