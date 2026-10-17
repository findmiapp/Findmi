"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import AuditChoiceList, { type AuditSelection } from "@/components/brand-audit/AuditChoiceList";
import {
  AUDIT_AGE_OPTIONS,
  AUDIT_AGE_RANGES,
  AUDIT_AUDIENCES,
  AUDIT_AUDIENCE_OPTIONS,
  AUDIT_CHALLENGES,
  AUDIT_CHALLENGE_OPTIONS,
  AUDIT_ENVIRONMENTS,
  AUDIT_ENVIRONMENT_OPTIONS,
  AUDIT_GOALS,
  AUDIT_GOAL_OPTIONS,
  AUDIT_KEYS,
  AUDIT_MARKET_SCOPES,
  AUDIT_MARKET_SCOPE_OPTIONS,
  AUDIT_PRIORITIES,
  AUDIT_PRIORITY_OPTIONS,
  EXCLUSIVE_KEYS,
  GEO_INTENT_LABELS,
  NYC_MARKET_SLUG,
  NYC_NEIGHBORHOODS,
  auditOptionLabel,
  placeKey,
  type AuditAnswer,
  type AuditKind,
  type AuditStep,
  type GeoCatalog,
  type GeoInput,
  type GeoIntent,
} from "@/lib/brand-audit-domain";
import type { ActionResult } from "./actions";

export type { AuditStep };

const STEPS = ["goals", "challenges", "audience", "markets", "environments"] as const;
type SectionStep = (typeof STEPS)[number];
const OPTIONAL: ReadonlySet<SectionStep> = new Set(["audience", "markets", "environments"]);

const toSelection = (answers: AuditAnswer[]): AuditSelection => Object.fromEntries(answers.map((a) => [a.key, a.detail ?? ""]));
const toAnswers = (s: AuditSelection) => Object.entries(s).map(([key, detail]) => ({ key, detail }));

/** One entry in the Markets step (client state; validated on the server). */
export interface GeoChoice {
  intent: GeoIntent;
  level: "market" | "area" | "neighborhood" | "place";
  id: string | null;
  key: string | null;
  label: string;
}
const geoId = (g: GeoChoice) => `${g.intent}:${g.level}:${g.id ?? g.key ?? placeKey(g.label)}`;

const COPY: Record<SectionStep, { title: string; copy: string }> = {
  goals: { title: "Your Goals", copy: "What are you trying to accomplish? Choose everything that applies." },
  challenges: {
    title: "Current Challenges",
    copy: "What’s making it harder to reach your goals today? Understanding what’s getting in your way helps Findmi identify better ideas, partners and opportunities for your brand.",
  },
  audience: { title: "Target Audience", copy: "Who are you most interested in reaching?" },
  markets: { title: "Markets", copy: "Where do you operate today, and where are you looking to grow or activate?" },
  environments: { title: "Activation Environments", copy: "Where are you interested in reaching people?" },
};

const PLACEHOLDER = {
  goals: ["Tell us what you’re hoping to accomplish, what success looks like, or anything we should understand.", "Have a goal we didn’t cover? Tell us what you’re working toward."],
  challenges: ["Tell us what’s getting in the way, what you’ve tried, or anything we should understand.", "Something else in the way? Tell us what’s making it harder."],
  audience: ["Tell us more about this audience — who they are, where they are, or what matters to them.", "Who else do you want to reach?"],
  priorities: ["Anything we should understand about this priority.", "Tell us about your other audience priority."],
  environments: ["Tell us more — specific places, formats or anything we should understand.", "Where else would you like to reach people?"],
} as const;

/** Findmi Brand Audit — Intro → Goals → Current Challenges → Target
 * Audience → Markets → Activation Environments → Review. Each Continue
 * saves that step on the server, so leaving at any point keeps every
 * answer; returning lands on the next unanswered section. The three newer
 * sections can be skipped for now (progressive profiling). */
export default function BrandAuditFlow({
  homeHref,
  initialStep,
  initial,
  catalog,
  complete,
  canEdit,
  readOnlyMessage,
  saveStep,
  saveAudience,
  saveMarkets,
  completeAudit,
}: {
  homeHref: string;
  initialStep: AuditStep;
  initial: {
    goals: AuditAnswer[];
    challenges: AuditAnswer[];
    audiences: AuditAnswer[];
    ages: AuditAnswer[];
    priorities: AuditAnswer[];
    marketScope: AuditAnswer[];
    environments: AuditAnswer[];
    geo: GeoChoice[];
  };
  catalog: GeoCatalog;
  complete: boolean;
  canEdit: boolean;
  readOnlyMessage: string | null;
  saveStep: (kind: AuditKind, answers: { key: string; detail: string }[]) => Promise<ActionResult>;
  saveAudience: (input: { audiences: { key: string; detail: string }[]; ages: { key: string; detail: string }[]; priorities: { key: string; detail: string }[] }) => Promise<ActionResult>;
  saveMarkets: (input: { scope: string | null; geo: GeoInput[] }) => Promise<ActionResult>;
  completeAudit: () => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [step, setStep] = useState<AuditStep>(canEdit ? initialStep : "review");
  const [goals, setGoals] = useState(() => toSelection(initial.goals));
  const [challenges, setChallenges] = useState(() => toSelection(initial.challenges));
  const [audiences, setAudiences] = useState(() => toSelection(initial.audiences));
  const [ages, setAges] = useState(() => toSelection(initial.ages));
  const [priorities, setPriorities] = useState(() => toSelection(initial.priorities));
  const [environments, setEnvironments] = useState(() => toSelection(initial.environments));
  const [scope, setScope] = useState<string | null>(initial.marketScope[0]?.key ?? null);
  const [geo, setGeo] = useState<GeoChoice[]>(initial.geo);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const go = (next: AuditStep) => {
    setError(null);
    setStep(next);
    window.scrollTo({ top: 0 });
  };
  const nextOf = (s: SectionStep): AuditStep => STEPS[STEPS.indexOf(s) + 1] ?? "review";
  const prevOf = (s: SectionStep): AuditStep => (s === "goals" ? (complete ? "review" : "intro") : STEPS[STEPS.indexOf(s) - 1]);

  const isEmpty = (s: SectionStep) =>
    s === "goals"
      ? Object.keys(goals).length === 0
      : s === "challenges"
        ? Object.keys(challenges).length === 0
        : s === "audience"
          ? Object.keys(audiences).length + Object.keys(ages).length + Object.keys(priorities).length === 0
          : s === "markets"
            ? !scope && geo.length === 0
            : Object.keys(environments).length === 0;

  const persist = (s: SectionStep): Promise<ActionResult> =>
    s === "goals"
      ? saveStep("goal", toAnswers(goals))
      : s === "challenges"
        ? saveStep("challenge", toAnswers(challenges))
        : s === "environments"
          ? saveStep("environment", toAnswers(environments))
          : s === "audience"
            ? saveAudience({ audiences: toAnswers(audiences), ages: toAnswers(ages), priorities: toAnswers(priorities) })
            : saveMarkets({ scope, geo: geo.map((g) => ({ intent: g.intent, level: g.level, id: g.id, key: g.key, label: g.label })) });

  const save = (s: SectionStep, then: () => void) =>
    startTransition(async () => {
      setError(null);
      const result = await persist(s);
      if (!result.ok) return setError(result.error);
      then();
    });

  const finish = () =>
    startTransition(async () => {
      setError(null);
      const result = await completeAudit();
      if (!result.ok) return setError(result.error);
      router.push(`${homeHref}?brand_audit=complete`);
      router.refresh();
    });

  const exit = (s: SectionStep) => {
    if (isEmpty(s)) {
      router.push(homeHref);
      return;
    }
    save(s, () => {
      router.push(homeHref);
      router.refresh();
    });
  };

  const stepIndex = step === "intro" ? 0 : step === "review" ? STEPS.length + 1 : STEPS.indexOf(step) + 1;
  const section = step !== "intro" && step !== "review" ? step : null;

  return (
    <div className="flex flex-col gap-5">
      {stepIndex > 0 && (
        <div>
          <div className="flex items-center justify-between gap-3 text-metadata text-muted">
            <span>{step === "review" ? "Review" : `Step ${stepIndex} of ${STEPS.length}`}</span>
            <Link href={homeHref} className="font-semibold text-muted hover:text-primary">
              {canEdit && step !== "review" ? "Cancel" : "Back To Home"}
            </Link>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/[0.06]" aria-hidden="true">
            <div className="h-full rounded-full bg-findmi transition-all" style={{ width: `${(Math.min(stepIndex, STEPS.length + 1) / (STEPS.length + 1)) * 100}%` }} />
          </div>
        </div>
      )}

      {step === "intro" && (
        <div className="rounded-3xl border border-black/[0.07] bg-white p-5 sm:p-6">
          <p className="text-label font-bold uppercase text-findmi-700">AI-Assisted Brand Audit Powered By Findmi</p>
          <h1 className="mt-1.5 font-display text-page-title font-bold leading-tight text-primary">Findmi Brand Audit</h1>
          <p className="mt-2 text-body text-secondary">
            Help Findmi understand where you&rsquo;re headed so we can surface better ideas, connections and opportunities for your brand.
          </p>
          <ol className="mt-4 flex flex-col gap-2 text-body text-primary">
            {["Your Goals", "Current Challenges", "Target Audience", "Markets", "Activation Environments"].map((label, i) => (
              <li key={label} className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-findmi-50 text-metadata font-bold text-findmi-700">{i + 1}</span>
                {label}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-metadata text-muted">About 5 minutes. Save anytime and come back later.</p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={() => go("goals")} className="flex h-12 items-center justify-center rounded-xl bg-findmi px-6 text-button font-bold text-white transition hover:bg-findmi-600">
              Start Brand Audit
            </button>
            <Link href={homeHref} className="flex h-12 items-center justify-center rounded-xl border border-black/10 px-6 text-button font-semibold text-primary transition hover:border-black/20">
              Maybe Later
            </Link>
          </div>
        </div>
      )}

      {section && (
        <>
          <div>
            <h1 className="font-display text-page-title font-bold leading-tight text-primary">{COPY[section].title}</h1>
            <p className="mt-1 text-body text-muted">{COPY[section].copy}</p>
          </div>

          {section === "goals" && (
            <AuditChoiceList keys={AUDIT_GOALS} options={AUDIT_GOAL_OPTIONS} value={goals} onChange={setGoals} placeholder={PLACEHOLDER.goals[0]} otherPlaceholder={PLACEHOLDER.goals[1]} />
          )}
          {section === "challenges" && (
            <AuditChoiceList
              keys={AUDIT_CHALLENGES}
              options={AUDIT_CHALLENGE_OPTIONS}
              value={challenges}
              onChange={setChallenges}
              placeholder={PLACEHOLDER.challenges[0]}
              otherPlaceholder={PLACEHOLDER.challenges[1]}
            />
          )}
          {section === "audience" && (
            <>
              <AuditChoiceList
                keys={AUDIT_AUDIENCES}
                options={AUDIT_AUDIENCE_OPTIONS}
                value={audiences}
                onChange={setAudiences}
                placeholder={PLACEHOLDER.audience[0]}
                otherPlaceholder={PLACEHOLDER.audience[1]}
              />
              <SubSection title="Age Ranges" copy="Which age groups are most important to your Brand?">
                <ChipSelect
                  options={AUDIT_AGE_RANGES.map((k) => ({ value: k, label: AUDIT_AGE_OPTIONS[k].label }))}
                  selected={Object.keys(ages)}
                  onToggle={(k) => setAges(toggleExclusive(ages, k, EXCLUSIVE_KEYS.age_range!))}
                  label="Age Ranges"
                />
              </SubSection>
              <SubSection title="Audience Priorities" copy="Any audience you especially want to prioritize? Optional — only if it applies.">
                <AuditChoiceList
                  keys={AUDIT_PRIORITIES}
                  options={AUDIT_PRIORITY_OPTIONS}
                  value={priorities}
                  onChange={(next) => {
                    const added = Object.keys(next).find((k) => !(k in priorities));
                    setPriorities(added ? toggleExclusive(priorities, added, EXCLUSIVE_KEYS.audience_priority!, next[added]) : next);
                  }}
                  placeholder={PLACEHOLDER.priorities[0]}
                  otherPlaceholder={PLACEHOLDER.priorities[1]}
                />
              </SubSection>
            </>
          )}
          {section === "markets" && <MarketsStep catalog={catalog} scope={scope} setScope={setScope} geo={geo} setGeo={setGeo} />}
          {section === "environments" && (
            <AuditChoiceList
              keys={AUDIT_ENVIRONMENTS}
              options={AUDIT_ENVIRONMENT_OPTIONS}
              value={environments}
              onChange={setEnvironments}
              placeholder={PLACEHOLDER.environments[0]}
              otherPlaceholder={PLACEHOLDER.environments[1]}
            />
          )}

          {error && <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-metadata font-semibold text-red-700">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => go(prevOf(section))}
              className="flex h-12 items-center justify-center rounded-xl border border-black/10 px-4 text-button font-semibold text-primary transition hover:border-black/20"
            >
              Back
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => exit(section)}
              className="flex h-12 items-center justify-center rounded-xl px-3 text-button font-semibold text-muted transition hover:text-primary disabled:opacity-50"
            >
              Save &amp; Exit
            </button>
            {OPTIONAL.has(section) && isEmpty(section) ? (
              <button
                type="button"
                onClick={() => go(nextOf(section))}
                className="ml-auto flex h-12 flex-1 items-center justify-center rounded-xl border border-black/10 px-5 text-button font-bold text-primary transition hover:border-black/20 sm:flex-none"
              >
                Skip For Now
              </button>
            ) : (
              <button
                type="button"
                disabled={pending || isEmpty(section)}
                onClick={() => save(section, () => go(nextOf(section)))}
                className="ml-auto flex h-12 flex-1 items-center justify-center rounded-xl bg-findmi px-5 text-button font-bold text-white transition hover:bg-findmi-600 disabled:opacity-40 sm:flex-none"
              >
                {pending ? "Saving…" : "Continue"}
              </button>
            )}
          </div>
        </>
      )}

      {step === "review" && (
        <>
          <div>
            <h1 className="font-display text-page-title font-bold leading-tight text-primary">{complete ? "Your Brand Audit" : "Review Your Brand Audit"}</h1>
            <p className="mt-1 text-body text-muted">{canEdit ? "You can update your answers anytime as your brand evolves." : readOnlyMessage}</p>
          </div>
          <ReviewSection title="Your Goals" onEdit={canEdit ? () => go("goals") : null}>
            <AnswerList kind="goal" selection={goals} />
          </ReviewSection>
          <ReviewSection title="Current Challenges" onEdit={canEdit ? () => go("challenges") : null}>
            <AnswerList kind="challenge" selection={challenges} />
          </ReviewSection>
          <ReviewSection title="Target Audience" onEdit={canEdit ? () => go("audience") : null}>
            <AnswerList kind="audience" selection={audiences} />
            <InlineList label="Age Ranges" kind="age_range" selection={ages} />
            <AnswerList kind="audience_priority" selection={priorities} label="Audience Priorities" />
          </ReviewSection>
          <ReviewSection title="Markets" onEdit={canEdit ? () => go("markets") : null}>
            {scope && <p className="text-card-title font-semibold text-primary">{auditOptionLabel("market_scope", scope)}</p>}
            {(["current", "priority"] as const).map((intent) => {
              const places = geo.filter((g) => g.intent === intent);
              return places.length > 0 ? (
                <p key={intent} className="mt-1 text-metadata text-secondary">
                  <span className="font-semibold text-primary">{GEO_INTENT_LABELS[intent]}:</span> {places.map((g) => g.label).join(" · ")}
                </p>
              ) : null;
            })}
            {!scope && geo.length === 0 && <p className="text-body text-muted">Not answered yet.</p>}
          </ReviewSection>
          <ReviewSection title="Activation Environments" onEdit={canEdit ? () => go("environments") : null}>
            <AnswerList kind="environment" selection={environments} />
          </ReviewSection>
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-metadata font-semibold text-red-700">{error}</p>}
          {canEdit && (
            <div className="flex flex-col gap-2 sm:flex-row">
              {complete ? (
                <Link href={homeHref} className="flex h-12 items-center justify-center rounded-xl bg-findmi px-6 text-button font-bold text-white transition hover:bg-findmi-600">
                  Done
                </Link>
              ) : (
                <button
                  type="button"
                  disabled={pending || Object.keys(goals).length === 0 || Object.keys(challenges).length === 0}
                  onClick={finish}
                  className="flex h-12 items-center justify-center rounded-xl bg-findmi px-6 text-button font-bold text-white transition hover:bg-findmi-600 disabled:opacity-40"
                >
                  {pending ? "Saving…" : "Complete Brand Audit"}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Selecting an exclusive choice ("Isn't A Primary Factor") clears the
 * rest; selecting anything else clears the exclusive one. */
function toggleExclusive(current: AuditSelection, key: string, exclusive: string, detail = ""): AuditSelection {
  if (key in current) {
    const next = { ...current };
    delete next[key];
    return next;
  }
  if (key === exclusive) return { [key]: detail };
  const next = { ...current, [key]: detail };
  delete next[exclusive];
  return next;
}

function SubSection({ title, copy, children }: { title: string; copy: string; children: ReactNode }) {
  return (
    <section className="mt-2">
      <h2 className="font-display text-section-title font-bold text-primary">{title}</h2>
      <p className="mt-0.5 text-metadata text-muted">{copy}</p>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function ChipSelect({ options, selected, onToggle, label }: { options: { value: string; label: string }[]; selected: string[]; onToggle: (v: string) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            role="checkbox"
            aria-checked={on}
            onClick={() => onToggle(o.value)}
            className={`min-h-10 rounded-full border px-3.5 text-metadata font-semibold transition ${on ? "border-findmi bg-findmi text-white" : "border-black/10 bg-white text-primary hover:border-findmi/40"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function AddPlace({ placeholder, onAdd, label }: { placeholder: string; onAdd: (label: string) => void; label: string }) {
  const [text, setText] = useState("");
  const add = () => {
    const v = text.trim();
    if (!v) return;
    onAdd(v.slice(0, 60));
    setText("");
  };
  return (
    <div className="mt-2 flex gap-2">
      <input
        autoCapitalize="words"
        value={text}
        maxLength={60}
        aria-label={label}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3 py-2.5 text-body text-primary placeholder:text-subtle focus:border-findmi/50 focus:outline-none focus:ring-2 focus:ring-findmi/20"
      />
      <button type="button" onClick={add} className="h-11 shrink-0 rounded-xl border border-black/10 px-4 text-button font-semibold text-primary hover:border-black/20">
        Add
      </button>
    </div>
  );
}

function MarketsStep({
  catalog,
  scope,
  setScope,
  geo,
  setGeo,
}: {
  catalog: GeoCatalog;
  scope: string | null;
  setScope: (s: string | null) => void;
  geo: GeoChoice[];
  setGeo: (g: GeoChoice[]) => void;
}) {
  const has = (g: GeoChoice) => geo.some((x) => geoId(x) === geoId(g));
  const toggle = (g: GeoChoice) => setGeo(has(g) ? geo.filter((x) => geoId(x) !== geoId(g)) : [...geo, g]);
  const nyc = catalog.markets.find((m) => m.slug === NYC_MARKET_SLUG) ?? null;
  const custom = (intent: GeoIntent, level: "place" | "neighborhood") => geo.filter((g) => g.intent === intent && g.level === level && !NYC_NEIGHBORHOODS.some((n) => n.key === g.key));

  const marketChips = (intent: GeoIntent) => (
    <ChipSelect
      label={GEO_INTENT_LABELS[intent]}
      options={catalog.markets.map((m) => ({ value: m.id, label: m.name }))}
      selected={geo.filter((g) => g.intent === intent && g.level === "market").map((g) => g.id ?? "")}
      onToggle={(id) => {
        const m = catalog.markets.find((x) => x.id === id)!;
        toggle({ intent, level: "market", id, key: null, label: m.name });
      }}
    />
  );
  const customChips = (list: GeoChoice[]) =>
    list.length > 0 && (
      <div className="mt-2 flex flex-wrap gap-2">
        {list.map((g) => (
          <button key={geoId(g)} type="button" onClick={() => toggle(g)} aria-label={`Remove ${g.label}`} className="min-h-10 rounded-full border border-findmi bg-findmi px-3.5 text-metadata font-semibold text-white">
            {g.label} ×
          </button>
        ))}
      </div>
    );
  const prioritized = (marketId: string) => geo.some((g) => g.intent === "priority" && g.level === "market" && g.id === marketId);

  return (
    <div className="flex flex-col gap-5">
      <SubSection title="Market Scope" copy="How broadly do you operate?">
        <div role="radiogroup" aria-label="Market Scope" className="grid grid-cols-2 gap-2">
          {AUDIT_MARKET_SCOPES.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={scope === k}
              onClick={() => setScope(scope === k ? null : k)}
              className={`rounded-2xl border px-3 py-2.5 text-left transition ${scope === k ? "border-findmi bg-findmi-50" : "border-black/10 bg-white hover:border-findmi/40"}`}
            >
              <span className="block text-card-title font-bold text-primary">{AUDIT_MARKET_SCOPE_OPTIONS[k].label}</span>
              <span className="block text-metadata italic text-muted">{AUDIT_MARKET_SCOPE_OPTIONS[k].description}</span>
            </button>
          ))}
        </div>
      </SubSection>

      <SubSection title="Current Markets" copy="Where you operate or sell today.">
        {marketChips("current")}
        {customChips(custom("current", "place"))}
        <AddPlace label="Add another current market" placeholder="Another market, e.g. Los Angeles" onAdd={(label) => toggle({ intent: "current", level: "place", id: null, key: placeKey(label), label })} />
      </SubSection>

      <SubSection title="Priority / Growth Markets" copy="Where you most want to grow or activate next.">
        {marketChips("priority")}
        {catalog.markets
          .filter((m) => prioritized(m.id) && catalog.areas.some((a) => a.market_id === m.id))
          .map((m) => (
            <div key={m.id} className="mt-3">
              <p className="text-metadata font-semibold text-secondary">Areas In {m.name}</p>
              <div className="mt-1.5">
                <ChipSelect
                  label={`Areas In ${m.name}`}
                  options={catalog.areas.filter((a) => a.market_id === m.id).map((a) => ({ value: a.id, label: a.name }))}
                  selected={geo.filter((g) => g.intent === "priority" && g.level === "area").map((g) => g.id ?? "")}
                  onToggle={(id) => {
                    const a = catalog.areas.find((x) => x.id === id)!;
                    toggle({ intent: "priority", level: "area", id, key: null, label: a.name });
                  }}
                />
              </div>
            </div>
          ))}
        {nyc && prioritized(nyc.id) && (
          <div className="mt-3">
            <p className="text-metadata font-semibold text-secondary">NYC Neighborhoods That Matter</p>
            <div className="mt-1.5">
              <ChipSelect
                label="NYC Neighborhoods"
                options={NYC_NEIGHBORHOODS.map((n) => ({ value: n.key, label: n.label }))}
                selected={geo.filter((g) => g.intent === "priority" && g.level === "neighborhood").map((g) => g.key ?? "")}
                onToggle={(key) => toggle({ intent: "priority", level: "neighborhood", id: null, key, label: NYC_NEIGHBORHOODS.find((n) => n.key === key)!.label })}
              />
            </div>
            {customChips(custom("priority", "neighborhood"))}
            <AddPlace label="Add another NYC neighborhood" placeholder="Another neighborhood" onAdd={(label) => toggle({ intent: "priority", level: "neighborhood", id: null, key: placeKey(label), label })} />
          </div>
        )}
        {customChips(custom("priority", "place"))}
        <AddPlace label="Add another priority market" placeholder="Another market, e.g. Austin" onAdd={(label) => toggle({ intent: "priority", level: "place", id: null, key: placeKey(label), label })} />
      </SubSection>
    </div>
  );
}

function ReviewSection({ title, onEdit, children }: { title: string; onEdit: (() => void) | null; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-black/[0.07] bg-white px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-section-title font-bold text-primary">{title}</h2>
        {onEdit && (
          <button type="button" onClick={onEdit} className="text-metadata font-semibold text-accent hover:underline">
            Edit
          </button>
        )}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function AnswerList({ kind, selection, label }: { kind: AuditKind; selection: AuditSelection; label?: string }) {
  const entries = AUDIT_KEYS[kind].filter((k) => k in selection).map((k) => [k, selection[k]] as const);
  if (entries.length === 0) return label ? null : <p className="text-body text-muted">Not answered yet.</p>;
  return (
    <div className={label ? "mt-2" : ""}>
      {label && <p className="text-metadata font-semibold text-secondary">{label}</p>}
      <ul className="flex flex-col gap-2">
        {entries.map(([key, detail]) => (
          <li key={key}>
            <p className="text-card-title font-semibold text-primary">{auditOptionLabel(kind, key)}</p>
            {detail.trim() && <p className="mt-0.5 whitespace-pre-line text-metadata text-secondary">{detail.trim()}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function InlineList({ label, kind, selection }: { label: string; kind: AuditKind; selection: AuditSelection }) {
  const keys = AUDIT_KEYS[kind].filter((k) => k in selection);
  if (keys.length === 0) return null;
  return (
    <p className="mt-2 text-metadata text-secondary">
      <span className="font-semibold text-primary">{label}:</span> {keys.map((k) => auditOptionLabel(kind, k)).join(" · ")}
    </p>
  );
}
