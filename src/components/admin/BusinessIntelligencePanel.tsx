import Link from "next/link";
import type { AdminBusinessIntelligence } from "@/lib/brand-audit";
import { auditOptionLabel, auditProgress, auditState, IDEA_RESPONSE_LABELS, type AuditAnswer, type AuditKind } from "@/lib/brand-audit-domain";

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" }) : null;

function Answers({ title, kind, answers }: { title: string; kind: AuditKind; answers: AuditAnswer[] }) {
  return (
    <div>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">{title}</h3>
      {answers.length === 0 ? (
        <p className="mt-1 text-sm text-ink/45">Not answered yet.</p>
      ) : (
        <ul className="mt-1.5 flex flex-col gap-2">
          {answers.map((a) => (
            <li key={a.key}>
              <p className="text-sm font-semibold text-ink">{auditOptionLabel(kind, a.key)}</p>
              {a.detail && <p className="mt-0.5 whitespace-pre-line text-sm text-ink/65">{a.detail}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Admin Business → Opportunity Intelligence: what the Brand wants (Goals),
 * what's in its way (Challenges), what it's open to (Idea signals), plus
 * Findmi's internal note. Admin only — the note is never read by any
 * Business surface. */
export default function BusinessIntelligencePanel({
  data,
  noteAction,
  noteSaved,
}: {
  data: AdminBusinessIntelligence;
  noteAction: (formData: FormData) => void | Promise<void>;
  noteSaved: boolean;
}) {
  if (!data.available) {
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Opportunity Intelligence isn&rsquo;t available yet — the Brand Audit + Opportunity Ideas migration hasn&rsquo;t been applied to this database.
      </p>
    );
  }
  const state = auditState(data.summary);
  const status = state === "complete" ? "Complete" : state === "in_progress" ? `In Progress · ${auditProgress(data.summary)}%` : "Not Started";

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="intel-audit" className="rounded-2xl border border-black/5 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="intel-audit" className="font-display text-lg font-semibold text-ink">
            Brand Audit
          </h2>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${state === "complete" ? "bg-findmi-50 text-findmi-700" : "bg-black/5 text-ink/55"}`}>{status}</span>
        </div>
        {(data.summary.updatedAt || data.summary.completedAt) && (
          <p className="mt-0.5 text-xs text-ink/45">
            {data.summary.completedAt && `Completed ${fmt(data.summary.completedAt)}`}
            {data.summary.completedAt && data.summary.updatedAt && " · "}
            {data.summary.updatedAt && `Last Updated ${fmt(data.summary.updatedAt)}`}
          </p>
        )}
        <div className="mt-3 grid gap-5 sm:grid-cols-2">
          <Answers title="What They Want · Goals" kind="goal" answers={data.goals} />
          <Answers title="What's In Their Way · Challenges" kind="challenge" answers={data.challenges} />
        </div>
      </section>

      <section aria-labelledby="intel-signals" className="rounded-2xl border border-black/5 bg-white p-4">
        <h2 id="intel-signals" className="font-display text-lg font-semibold text-ink">
          Idea Signals
        </h2>
        <p className="mt-0.5 text-xs text-ink/45">What types of opportunities they&rsquo;re open to.</p>
        {data.signals.length === 0 ? (
          <p className="mt-2 text-sm text-ink/45">No responses to Opportunity Ideas yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-black/5">
            {data.signals.map((s) => (
              <li key={s.ideaId} className="py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={`/admin/opportunities/ideas/${s.ideaId}`} className="text-sm font-semibold text-ink hover:underline">
                    {s.title}
                  </Link>
                  <span className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${s.response === "not_for_us" ? "bg-black/5 text-ink/50" : "bg-findmi-50 text-findmi-700"}`}>
                      {IDEA_RESPONSE_LABELS[s.response]}
                    </span>
                    <span className="text-xs text-ink/40">{fmt(s.updatedAt)}</span>
                  </span>
                </div>
                {s.note && <p className="mt-0.5 whitespace-pre-line text-sm text-ink/65">&ldquo;{s.note}&rdquo;</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="intel-note" className="rounded-2xl border border-black/5 bg-white p-4">
        <h2 id="intel-note" className="font-display text-lg font-semibold text-ink">
          Internal Note
        </h2>
        <p className="mt-0.5 text-xs text-ink/45">Findmi Admin only. Never visible to the Business or the public.</p>
        {noteSaved && <p className="mt-2 rounded-xl border border-findmi/20 bg-findmi-50 px-3 py-2 text-sm text-findmi-700">Note saved.</p>}
        <form action={noteAction} className="mt-2">
          <textarea
            name="note"
            rows={4}
            maxLength={4000}
            defaultValue={data.note?.text ?? ""}
            autoCapitalize="sentences"
            placeholder="Commercial context from calls, follow-ups, anything useful."
            className="w-full resize-y rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
          />
          {data.note && <p className="mt-1 text-xs text-ink/40">Updated {fmt(data.note.updatedAt)}</p>}
          <button type="submit" className="mt-2 h-10 rounded-xl bg-ink px-4 text-sm font-semibold text-white hover:bg-ink/85">
            Save Note
          </button>
        </form>
      </section>
    </div>
  );
}
