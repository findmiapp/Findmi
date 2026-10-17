import Link from "next/link";
import type { ReactNode } from "react";
import { getCommandCenter } from "@/lib/brand-intelligence";
import { SIGNAL_HEADLINE, auditChangeHeadline, type IntelligenceSignal } from "@/lib/brand-intelligence-domain";
import { AUDIT_SECTION_LABELS, IDEA_RESPONSE_LABELS, IDEA_RESPONSES, IDEA_STATUS_LABELS, isIdeaStatus, type IdeaResponse } from "@/lib/brand-audit-domain";
import OpportunitiesAdminTabs from "../OpportunitiesAdminTabs";
import { formatOpportunityDate } from "../format";
import { markAllReviewed, markReviewed } from "./actions";

export const dynamic = "force-dynamic";

const VIEWS = [
  { key: "recent", label: "Recent" },
  { key: "brands", label: "By Brand" },
  { key: "ideas", label: "By Idea" },
] as const;
type View = (typeof VIEWS)[number]["key"];

const PAGE = "/admin/opportunities/intelligence";
const brandHref = (id: string) => `/admin/businesses/${id}?tab=intelligence`;
const ideaHref = (id: string) => `/admin/opportunities/ideas/${id}`;

const RESPONSE_TONE: Record<IdeaResponse, string> = {
  interested: "bg-findmi-50 text-findmi-700",
  maybe: "bg-amber-50 text-amber-700",
  not_for_us: "bg-black/5 text-ink/50",
};

function Pill({ children, className }: { children: ReactNode; className: string }) {
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${className}`}>{children}</span>;
}

const NewPill = () => <Pill className="bg-findmi text-white">New</Pill>;

function Metric({ label, value, href }: { label: string; value: number; href?: string }) {
  const body = (
    <>
      <span className="block font-display text-2xl font-semibold tabular-nums text-ink">{value}</span>
      <span className="block text-xs font-medium text-ink/55">{label}</span>
    </>
  );
  return href ? (
    <Link href={href} className="rounded-xl border border-black/5 bg-white px-3 py-2.5 transition hover:border-black/15">
      {body}
    </Link>
  ) : (
    <div className="rounded-xl border border-black/5 bg-white px-3 py-2.5">{body}</div>
  );
}

function Line({ label, values, max = 4 }: { label: string; values: string[]; max?: number }) {
  if (values.length === 0) return null;
  return (
    <p className="mt-0.5 text-sm text-ink/75">
      <span className="font-semibold text-ink/50">{label}:</span> {values.slice(0, max).join(" · ")}
      {values.length > max ? ` +${values.length - max}` : ""}
    </p>
  );
}

/** Compact who / where / what lines; the Business Intelligence tab has
 * every answer with the Brand's own context. */
function AuditSummaryLines({ audit: a, brandView = false }: { audit: NonNullable<IntelligenceSignal["audit"]>; brandView?: boolean }) {
  return (
    <div className="mt-1">
      <Line label="Wants" values={a.goals} />
      <Line label="Audience" values={a.audiences} max={3} />
      <Line label="Age" values={a.ages} max={6} />
      <Line label="Priority Markets" values={a.priorityMarkets} />
      {brandView && <Line label="Current Markets" values={a.scope ? [a.scope, ...a.currentMarkets] : a.currentMarkets} />}
      <Line label="Environments" values={a.environments} max={3} />
      <Line label="In The Way" values={a.challenges} max={3} />
    </div>
  );
}

function SmallLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-xs font-semibold text-findmi-700 hover:underline">
      {children}
    </Link>
  );
}

function SignalCard({ s, returnTo, canReview }: { s: IntelligenceSignal; returnTo: string; canReview: boolean }) {
  return (
    <li className={`rounded-xl border bg-white px-4 py-3 ${s.isNew ? "border-findmi/40" : "border-black/5"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={brandHref(s.business.id)} className="text-sm font-bold text-ink hover:underline">
            {s.business.name}
          </Link>
          <p className="mt-0.5 text-sm text-ink/75">
            {s.idea ? (
              <>
                {SIGNAL_HEADLINE[s.event]} <span className="font-semibold">{IDEA_RESPONSE_LABELS[s.idea.response]}</span> to{" "}
                <Link href={ideaHref(s.idea.id)} className="font-semibold text-ink hover:underline">
                  {s.idea.title}
                </Link>
              </>
            ) : (
              <>
                {auditChangeHeadline(s, AUDIT_SECTION_LABELS) ?? SIGNAL_HEADLINE[s.event]}
                {s.audit && s.audit.progress < 100 ? ` · Profile ${s.audit.progress}%` : ""}
              </>
            )}
          </p>
        </div>
        <span className="flex items-center gap-2">
          {s.isNew && <NewPill />}
          {s.idea && <Pill className={RESPONSE_TONE[s.idea.response]}>{IDEA_RESPONSE_LABELS[s.idea.response]}</Pill>}
          <span className="text-xs text-ink/40">{formatOpportunityDate(s.at)}</span>
        </span>
      </div>
      {s.idea?.note && <p className="mt-1.5 whitespace-pre-line text-sm text-ink/70">&ldquo;{s.idea.note}&rdquo;</p>}
      {s.audit && <AuditSummaryLines audit={s.audit} />}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <SmallLink href={brandHref(s.business.id)}>{s.idea ? "View Brand" : "View Intelligence"}</SmallLink>
        {s.idea && <SmallLink href={ideaHref(s.idea.id)}>View Idea</SmallLink>}
        {s.isNew && canReview && (
          <form action={markReviewed.bind(null, s.type, s.id, returnTo)} className="ml-auto">
            <button type="submit" className="text-xs font-semibold text-ink/55 hover:text-ink">
              Mark Reviewed
            </button>
          </form>
        )}
      </div>
    </li>
  );
}

/** Admin → Opportunities → Intelligence — the cross-Business command
 * center over existing Brand Audit + Opportunity Idea data: what changed,
 * which Brands want something, what they want, what's in their way, and
 * which Ideas generate demand. Counts are exact; nothing is estimated. */
export default async function AdminIntelligencePage({ searchParams }: { searchParams: Promise<{ view?: string; new?: string; error?: string; reviewed?: string }> }) {
  const sp = await searchParams;
  const view: View = VIEWS.some((v) => v.key === sp.view) ? (sp.view as View) : "recent";
  const newOnly = sp.new === "1";
  const cc = await getCommandCenter();
  const m = cc.metrics;
  const returnTo = `${PAGE}?view=${view}${newOnly ? "&new=1" : ""}`;
  const signals = newOnly ? cc.signals.filter((s) => s.isNew) : cc.signals;
  const brands = newOnly ? cc.byBrand.filter((b) => b.isNew) : cc.byBrand;
  const ideas = newOnly ? cc.byIdea.filter((i) => i.newCount > 0) : cc.byIdea;
  const link = (v: View, n: boolean) => `${PAGE}?view=${v}${n ? "&new=1" : ""}`;

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Opportunities</h1>
      <p className="mt-1 max-w-xl text-sm text-ink/50">What Brands want, what&rsquo;s in their way, and which Ideas they&rsquo;re open to.</p>
      <OpportunitiesAdminTabs active="intelligence" />

      {!cc.available ? (
        <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Opportunity Intelligence isn&rsquo;t available yet — the Brand Audit + Opportunity Ideas migration hasn&rsquo;t been applied to this database.
        </p>
      ) : (
        <>
          {!cc.reviewsAvailable && (
            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Review tracking isn&rsquo;t available yet — apply the Brand Intelligence V1.1 migration. Until then every signal shows as New.
            </p>
          )}
          {sp.error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{sp.error}</p>}
          {sp.reviewed === "all" && !sp.error && <p className="mt-4 rounded-xl border border-findmi/20 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">Everything is marked reviewed.</p>}

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="New Signals" value={m.newSignals} href={link("recent", true)} />
            <Metric label="Interested Signals" value={m.interested} href={link("ideas", false)} />
            <Metric label="Maybe Signals" value={m.maybe} href={link("ideas", false)} />
            <Metric label="Brands Open To Ideas" value={m.brandsOpenToIdeas} href={link("brands", false)} />
            <Metric label="Brands Profiled" value={m.brandsProfiled} href={link("brands", false)} />
            <Metric label="Completed Audits" value={m.completedAudits} href={link("brands", false)} />
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <nav aria-label="Intelligence views" className="flex gap-1.5">
              {VIEWS.map((v) => (
                <Link
                  key={v.key}
                  href={link(v.key, newOnly)}
                  aria-current={view === v.key ? "page" : undefined}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${view === v.key ? "bg-ink text-white" : "bg-black/5 text-ink/60 hover:bg-black/10"}`}
                >
                  {v.label}
                </Link>
              ))}
            </nav>
            <div className="flex items-center gap-3">
              <Link href={link(view, !newOnly)} className="text-xs font-semibold text-ink/60 hover:text-ink">
                {newOnly ? "Show All" : `New Only (${m.newSignals})`}
              </Link>
              {m.newSignals > 0 && cc.reviewsAvailable && (
                <form action={markAllReviewed.bind(null, returnTo)}>
                  <button type="submit" className="h-9 rounded-xl border border-black/10 bg-white px-3 text-xs font-semibold text-ink hover:border-black/25">
                    Mark All Reviewed
                  </button>
                </form>
              )}
            </div>
          </div>

          {view === "recent" &&
            (signals.length === 0 ? (
              <p className="mt-5 text-sm text-ink/50">{newOnly ? "Nothing new since your last review." : "No Brand intelligence yet."}</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {signals.slice(0, 100).map((s) => (
                  <SignalCard key={`${s.type}:${s.id}`} s={s} returnTo={returnTo} canReview={cc.reviewsAvailable} />
                ))}
              </ul>
            ))}

          {view === "brands" &&
            (brands.length === 0 ? (
              <p className="mt-5 text-sm text-ink/50">{newOnly ? "No Brands with new intelligence." : "No Brand intelligence yet."}</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {brands.map((b) => (
                  <li key={b.business.id}>
                    <Link href={brandHref(b.business.id)} className={`block rounded-xl border bg-white px-4 py-3 transition hover:border-black/20 ${b.isNew ? "border-findmi/40" : "border-black/5"}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="text-sm font-bold text-ink">{b.business.name}</p>
                        <span className="flex items-center gap-2">
                          {b.isNew && <NewPill />}
                          <Pill className={b.auditEvent && b.auditEvent !== "audit_in_progress" ? "bg-findmi-50 text-findmi-700" : "bg-black/5 text-ink/50"}>
                            {!b.audit ? "No Audit" : b.auditEvent === "audit_in_progress" ? `Audit ${b.audit.progress}%` : "Audit Complete"}
                          </Pill>
                        </span>
                      </div>
                      {b.audit && <AuditSummaryLines audit={b.audit} brandView />}
                      {b.openTo.length > 0 && <Line label="Open To" values={b.openTo} />}
                      <p className="mt-1.5 text-xs font-semibold text-ink/50">
                        Interested {b.interested} · Maybe {b.maybe} · Not For Us {b.notForUs} · Last activity {formatOpportunityDate(b.lastAt)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            ))}

          {view === "ideas" &&
            (ideas.length === 0 ? (
              <p className="mt-5 text-sm text-ink/50">{newOnly ? "No new Idea responses." : "No Idea responses yet."}</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {ideas.map((i) => (
                  <li key={i.idea.id} className="rounded-xl border border-black/5 bg-white px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <Link href={ideaHref(i.idea.id)} className="text-sm font-bold text-ink hover:underline">
                        {i.idea.title}
                      </Link>
                      <span className="flex items-center gap-2">
                        {i.newCount > 0 && <Pill className="bg-findmi text-white">{i.newCount} New</Pill>}
                        {i.idea.status !== "published" && <Pill className="bg-black/5 text-ink/50">{isIdeaStatus(i.idea.status) ? IDEA_STATUS_LABELS[i.idea.status] : i.idea.status}</Pill>}
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-semibold text-ink/55">
                      Interested {i.counts.interested} · Maybe {i.counts.maybe} · Not For Us {i.counts.not_for_us}
                    </p>
                    {IDEA_RESPONSES.filter((r) => r !== "not_for_us" && i.businesses[r].length > 0).map((r) => (
                      <p key={r} className="mt-1 text-sm text-ink/75">
                        <span className="font-semibold text-ink/50">{IDEA_RESPONSE_LABELS[r]}:</span>{" "}
                        {i.businesses[r].map((b, n) => (
                          <span key={b.id}>
                            {n > 0 && ", "}
                            <Link href={brandHref(b.id)} className="hover:underline">
                              {b.name}
                            </Link>
                          </span>
                        ))}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            ))}
        </>
      )}
    </div>
  );
}
