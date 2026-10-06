"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import {
  GOAL_BUDGET,
  GOAL_BUDGET_BANDS,
  GOAL_INTERESTS,
  GOAL_INTEREST_LABELS,
  GOAL_LIMITS,
  GOAL_OBJECTIVES,
  GOAL_OBJECTIVE_LABELS,
  GOAL_TIMINGS,
  GOAL_TIMING_LABELS,
  suggestGoalTitle,
  type GoalBudgetBand,
  type GoalInterest,
  type GoalObjective,
  type GoalTiming,
} from "@/lib/opportunity-goals-domain";
import type { GoalFormState } from "../actions";

export interface GoalWizardInitial {
  title: string;
  objectives: GoalObjective[];
  opportunity_interests: GoalInterest[];
  audience_text: string;
  market_ids: string[];
  markets_text: string;
  budget_band: GoalBudgetBand | null;
  timing: GoalTiming | null;
  starts_on: string;
  ends_on: string;
  notes: string;
}

const STEPS = ["objectives", "interests", "audience", "where", "budget", "when", "notes", "review"] as const;
type Step = (typeof STEPS)[number];

const QUESTIONS: Record<Step, { title: string; copy: string }> = {
  objectives: { title: "What are you trying to accomplish?", copy: "Choose everything that applies." },
  interests: { title: "What kind of Opportunities interest you?", copy: "Choose everything that applies." },
  audience: { title: "Who are you trying to reach?", copy: "Optional. Describe the customers or audience you have in mind." },
  where: { title: "Where?", copy: "Choose the markets you're interested in, or describe the area." },
  budget: { title: "What's your budget?", copy: "A rough range helps Findmi surface the right Opportunities." },
  when: { title: "When?", copy: "When would you like this to happen?" },
  notes: { title: "Anything else Findmi should know?", copy: "Optional." },
  review: { title: "Review your goal", copy: "Give it a short name you'll recognize, then submit." },
};

const textClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-base text-primary placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";

function Check() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  );
}

function Choice({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`flex min-h-[52px] w-full items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-left text-[15px] font-semibold leading-snug transition active:scale-[0.98] ${
        selected ? "border-findmi bg-findmi-50 text-findmi-700" : "border-black/10 bg-white text-primary hover:border-black/20"
      }`}
    >
      <span className="min-w-0">{label}</span>
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${selected ? "bg-findmi text-white" : "border border-black/15 text-transparent"}`}
      >
        <Check />
      </span>
    </button>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex h-12 flex-1 items-center justify-center rounded-xl bg-findmi px-5 text-button font-bold text-white transition hover:bg-findmi-600 disabled:opacity-60"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

/** Opportunities V2 — the Business goal flow: one question per step,
 * tactile multi-select cards, every answer kept in local state and posted
 * once on Submit. The server (submitGoal → lib/opportunity-goals.ts)
 * re-validates everything and enforces owner/manager-only writes. */
export default function GoalWizard({
  action,
  markets,
  initial,
  submitLabel,
  cancelHref,
}: {
  action: (state: GoalFormState, formData: FormData) => Promise<GoalFormState>;
  markets: { id: string; name: string }[];
  initial: GoalWizardInitial;
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, { error: null });
  const [step, setStep] = useState(0);
  const [v, setV] = useState(initial);
  const [titleTouched, setTitleTouched] = useState(Boolean(initial.title));
  const current = STEPS[step];
  const set = <K extends keyof GoalWizardInitial>(key: K, value: GoalWizardInitial[K]) => setV((prev) => ({ ...prev, [key]: value }));
  const toggle = <T extends string>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  const suggested = suggestGoalTitle(v.objectives, v.opportunity_interests);
  const title = titleTouched ? v.title : suggested;

  const canContinue: Record<Step, boolean> = {
    objectives: v.objectives.length > 0,
    interests: v.opportunity_interests.length > 0,
    audience: true,
    where: true,
    budget: v.budget_band !== null,
    when: v.timing !== null && (v.timing !== "specific_dates" || Boolean(v.starts_on)),
    notes: true,
    review: title.trim().length > 0,
  };

  return (
    <form
      action={formAction}
      // Enter in a text field must never submit before the Review step.
      onKeyDown={(e) => {
        if (e.key === "Enter" && current !== "review" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
      }}
      className="flex flex-col gap-5"
    >
      {/* Every answer is always posted, whatever step is showing. */}
      {v.objectives.map((o) => (
        <input key={o} type="hidden" name="objectives" value={o} />
      ))}
      {v.opportunity_interests.map((i) => (
        <input key={i} type="hidden" name="opportunity_interests" value={i} />
      ))}
      {v.market_ids.map((m) => (
        <input key={m} type="hidden" name="market_ids" value={m} />
      ))}
      <input type="hidden" name="audience_text" value={v.audience_text} />
      <input type="hidden" name="markets_text" value={v.markets_text} />
      <input type="hidden" name="budget_band" value={v.budget_band ?? ""} />
      <input type="hidden" name="timing" value={v.timing ?? ""} />
      <input type="hidden" name="starts_on" value={v.timing === "specific_dates" ? v.starts_on : ""} />
      <input type="hidden" name="ends_on" value={v.timing === "specific_dates" ? v.ends_on : ""} />
      <input type="hidden" name="notes" value={v.notes} />
      <input type="hidden" name="title" value={title} />

      <div>
        <div className="flex items-center justify-between gap-3 text-metadata text-muted">
          <span>
            Step {step + 1} of {STEPS.length}
          </span>
          <Link href={cancelHref} className="font-semibold text-muted hover:text-primary">
            Cancel
          </Link>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/[0.06]" aria-hidden="true">
          <div className="h-full rounded-full bg-findmi transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
      </div>

      <div>
        <h1 className="font-display text-page-title font-bold leading-tight text-primary">{QUESTIONS[current].title}</h1>
        <p className="mt-1 text-body text-muted">{QUESTIONS[current].copy}</p>
      </div>

      {current === "objectives" && (
        <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
          {GOAL_OBJECTIVES.map((o) => (
            <Choice key={o} label={GOAL_OBJECTIVE_LABELS[o]} selected={v.objectives.includes(o)} onClick={() => set("objectives", toggle(v.objectives, o))} />
          ))}
        </div>
      )}

      {current === "interests" && (
        <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
          {GOAL_INTERESTS.map((i) => (
            <Choice
              key={i}
              label={GOAL_INTEREST_LABELS[i]}
              selected={v.opportunity_interests.includes(i)}
              onClick={() => set("opportunity_interests", toggle(v.opportunity_interests, i))}
            />
          ))}
        </div>
      )}

      {current === "audience" && (
        <textarea
          value={v.audience_text}
          onChange={(e) => set("audience_text", e.target.value)}
          rows={4}
          maxLength={GOAL_LIMITS.audience_text}
          placeholder="e.g. Young professionals in apartment buildings who drink coffee at home"
          aria-label="Audience"
          className={`${textClass} resize-y`}
        />
      )}

      {current === "where" && (
        <div className="flex flex-col gap-3">
          {markets.length > 0 && (
            <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
              {markets.map((m) => (
                <Choice key={m.id} label={m.name} selected={v.market_ids.includes(m.id)} onClick={() => set("market_ids", toggle(v.market_ids, m.id))} />
              ))}
            </div>
          )}
          <label className="block">
            <span className="mb-1.5 block text-metadata font-semibold text-secondary">Other Areas</span>
            <input
              type="text"
              value={v.markets_text}
              onChange={(e) => set("markets_text", e.target.value)}
              maxLength={GOAL_LIMITS.markets_text}
              placeholder="e.g. Hoboken, Jersey City, Westchester"
              className={textClass}
            />
          </label>
        </div>
      )}

      {current === "budget" && (
        <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
          {GOAL_BUDGET_BANDS.map((b) => (
            <Choice key={b} label={GOAL_BUDGET[b].label} selected={v.budget_band === b} onClick={() => set("budget_band", b)} />
          ))}
        </div>
      )}

      {current === "when" && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
            {GOAL_TIMINGS.map((t) => (
              <Choice key={t} label={GOAL_TIMING_LABELS[t]} selected={v.timing === t} onClick={() => set("timing", t)} />
            ))}
          </div>
          {v.timing === "specific_dates" && (
            <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-metadata font-semibold text-secondary">Start Date</span>
                <input type="date" value={v.starts_on} onChange={(e) => set("starts_on", e.target.value)} className={textClass} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-metadata font-semibold text-secondary">End Date (Optional)</span>
                <input type="date" value={v.ends_on} min={v.starts_on || undefined} onChange={(e) => set("ends_on", e.target.value)} className={textClass} />
              </label>
            </div>
          )}
        </div>
      )}

      {current === "notes" && (
        <textarea
          value={v.notes}
          onChange={(e) => set("notes", e.target.value)}
          rows={5}
          maxLength={GOAL_LIMITS.notes}
          placeholder="Products you want to feature, constraints, past activations that worked…"
          aria-label="Notes"
          className={`${textClass} resize-y`}
        />
      )}

      {current === "review" && (
        <div className="flex flex-col gap-4">
          <label className="block">
            <span className="mb-1.5 block text-metadata font-semibold text-secondary">Goal Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitleTouched(true);
                set("title", e.target.value);
              }}
              maxLength={GOAL_LIMITS.title}
              className={textClass}
            />
          </label>
          <dl className="flex flex-col divide-y divide-black/[0.06] rounded-2xl border border-black/[0.07] bg-white">
            <ReviewRow label="Goals" value={v.objectives.map((o) => GOAL_OBJECTIVE_LABELS[o]).join(", ")} onEdit={() => setStep(0)} />
            <ReviewRow label="Opportunities" value={v.opportunity_interests.map((i) => GOAL_INTEREST_LABELS[i]).join(", ")} onEdit={() => setStep(1)} />
            <ReviewRow label="Audience" value={v.audience_text || "—"} onEdit={() => setStep(2)} />
            <ReviewRow
              label="Where"
              value={[...markets.filter((m) => v.market_ids.includes(m.id)).map((m) => m.name), v.markets_text].filter(Boolean).join(" · ") || "Anywhere"}
              onEdit={() => setStep(3)}
            />
            <ReviewRow label="Budget" value={v.budget_band ? GOAL_BUDGET[v.budget_band].label : "—"} onEdit={() => setStep(4)} />
            <ReviewRow
              label="When"
              value={v.timing ? (v.timing === "specific_dates" ? [v.starts_on, v.ends_on].filter(Boolean).join(" – ") : GOAL_TIMING_LABELS[v.timing]) : "—"}
              onEdit={() => setStep(5)}
            />
            <ReviewRow label="Notes" value={v.notes || "—"} onEdit={() => setStep(6)} />
          </dl>
        </div>
      )}

      {state.error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-body text-red-700">{state.error}</p>}

      <div className="flex items-center gap-2 pt-1">
        {step > 0 && (
          <button
            type="button"
            onClick={() => setStep((s) => s - 1)}
            className="flex h-12 items-center justify-center rounded-xl border border-black/10 bg-white px-5 text-button font-semibold text-primary transition hover:border-black/20"
          >
            Back
          </button>
        )}
        {current === "review" ? (
          <SubmitButton label={submitLabel} />
        ) : (
          <button
            type="button"
            disabled={!canContinue[current]}
            onClick={() => setStep((s) => s + 1)}
            className="flex h-12 flex-1 items-center justify-center rounded-xl bg-findmi px-5 text-button font-bold text-white transition hover:bg-findmi-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {current === "audience" || current === "notes" ? (current === "audience" ? (v.audience_text ? "Continue" : "Skip") : v.notes ? "Continue" : "Skip") : "Continue"}
          </button>
        )}
      </div>
    </form>
  );
}

function ReviewRow({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <dt className="text-[11px] font-semibold uppercase tracking-wide text-subtle">{label}</dt>
        <dd className="mt-0.5 break-words text-metadata text-secondary">{value}</dd>
      </div>
      <button type="button" onClick={onEdit} className="shrink-0 text-metadata font-semibold text-accent hover:underline">
        Edit
      </button>
    </div>
  );
}
