import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminIdea } from "@/lib/brand-audit";
import { IDEA_RESPONSES, IDEA_RESPONSE_LABELS, IDEA_STATUS_LABELS, type IdeaStatus } from "@/lib/brand-audit-domain";
import IdeaForm from "../IdeaForm";
import { changeIdeaStatus, updateIdea } from "../actions";
import { formatOpportunityDate } from "../../format";

export const dynamic = "force-dynamic";

const NEXT_STATUSES: Record<IdeaStatus, { to: IdeaStatus; label: string }[]> = {
  draft: [
    { to: "published", label: "Publish" },
    { to: "archived", label: "Archive" },
  ],
  published: [
    { to: "draft", label: "Move To Draft" },
    { to: "archived", label: "Archive" },
  ],
  archived: [
    { to: "published", label: "Republish" },
    { to: "draft", label: "Move To Draft" },
  ],
};

/** One Opportunity Idea: edit + lifecycle, and its response intelligence
 * (exact counts and responding Businesses — nothing estimated). */
export default async function AdminIdeaPage({ params, searchParams }: { params: Promise<{ ideaId: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { ideaId } = await params;
  const { error, saved } = await searchParams;
  const detail = await getAdminIdea(ideaId);
  if (!detail) notFound();
  const { idea, targets, responses, counts, noResponse } = detail;

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-ink/45">
        <Link href="/admin/opportunities/ideas" className="hover:underline">
          Ideas
        </Link>
        <span>/</span>
        <span className="truncate">{idea.title}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">{idea.title}</h1>
        <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink/55">{IDEA_STATUS_LABELS[idea.status]}</span>
      </div>
      <p className="mt-1 text-xs text-ink/45">
        Created {formatOpportunityDate(idea.created_at)} · Updated {formatOpportunityDate(idea.updated_at)}
      </p>
      {error && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {saved && !error && <p className="mt-3 rounded-xl border border-findmi/20 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">Saved.</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        {NEXT_STATUSES[idea.status].map((s) => (
          <form key={s.to} action={changeIdeaStatus.bind(null, idea.id, s.to)}>
            <button type="submit" className="h-10 rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-ink hover:border-black/25">
              {s.label}
            </button>
          </form>
        ))}
      </div>

      <section aria-labelledby="idea-responses" className="mt-6 rounded-2xl border border-black/5 bg-white p-4">
        <h2 id="idea-responses" className="font-display text-lg font-semibold text-ink">
          Brand Responses
        </h2>
        <dl className="mt-3 grid grid-cols-3 gap-2 sm:max-w-md">
          {IDEA_RESPONSES.map((r) => (
            <div key={r} className="rounded-xl bg-black/[0.03] px-3 py-2.5">
              <dd className="font-display text-2xl font-semibold tabular-nums text-ink">{counts[r]}</dd>
              <dt className="text-xs font-medium text-ink/55">{IDEA_RESPONSE_LABELS[r]}</dt>
            </div>
          ))}
        </dl>
        {noResponse !== null && <p className="mt-2 text-xs text-ink/50">{noResponse} targeted {noResponse === 1 ? "Business hasn’t" : "Businesses haven’t"} responded yet.</p>}
        {responses.length === 0 ? (
          <p className="mt-3 text-sm text-ink/50">No responses yet.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            {IDEA_RESPONSES.filter((r) => counts[r] > 0).map((r) => (
              <div key={r}>
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">{IDEA_RESPONSE_LABELS[r]} Brands</h3>
                <ul className="mt-1.5 flex flex-col divide-y divide-black/5">
                  {responses
                    .filter((x) => x.response === r)
                    .map((x) => (
                      <li key={x.businessId} className="py-2">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <Link href={`/admin/businesses/${x.businessId}?tab=intelligence`} className="text-sm font-semibold text-findmi-700 hover:underline">
                            {x.businessName}
                          </Link>
                          <span className="text-xs text-ink/40">{formatOpportunityDate(x.updatedAt)}</span>
                        </div>
                        {x.note && <p className="mt-0.5 whitespace-pre-line text-sm text-ink/70">&ldquo;{x.note}&rdquo;</p>}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="idea-edit" className="mt-6">
        <h2 id="idea-edit" className="font-display text-lg font-semibold text-ink">
          Edit Idea
        </h2>
        <div className="mt-3">
          <IdeaForm idea={idea} targets={targets} action={updateIdea.bind(null, idea.id)} saveLabel="Save Idea" cancelHref="/admin/opportunities/ideas" />
        </div>
      </section>
    </div>
  );
}
