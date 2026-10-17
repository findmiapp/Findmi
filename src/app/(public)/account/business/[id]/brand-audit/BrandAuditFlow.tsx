"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import AuditChoiceList, { type AuditSelection } from "@/components/brand-audit/AuditChoiceList";
import {
  AUDIT_CHALLENGES,
  AUDIT_CHALLENGE_OPTIONS,
  AUDIT_GOALS,
  AUDIT_GOAL_OPTIONS,
  AUDIT_KEYS,
  auditOptionLabel,
  type AuditAnswer,
  type AuditKind,
} from "@/lib/brand-audit-domain";
import type { ActionResult } from "./actions";

export type AuditStep = "intro" | "goals" | "challenges" | "review";

const toSelection = (answers: AuditAnswer[]): AuditSelection => Object.fromEntries(answers.map((a) => [a.key, a.detail ?? ""]));
const toAnswers = (s: AuditSelection) => Object.entries(s).map(([key, detail]) => ({ key, detail }));

const COPY = {
  goals: {
    title: "Your Goals",
    copy: "What are you trying to accomplish? Choose everything that applies.",
    placeholder: "Tell us what you’re hoping to accomplish, what success looks like, or anything we should understand.",
    other: "Have a goal we didn’t cover? Tell us what you’re working toward.",
  },
  challenges: {
    title: "Current Challenges",
    copy: "What’s making it harder to reach your goals today? Understanding what’s getting in your way helps Findmi identify better ideas, partners and opportunities for your brand.",
    placeholder: "Tell us what’s getting in the way, what you’ve tried, or anything we should understand.",
    other: "Something else in the way? Tell us what’s making it harder.",
  },
} as const;

/** Findmi Brand Audit — Intro → Goals → Current Challenges → Review.
 * Each Continue saves that step on the server, so leaving at any point
 * keeps every answer; returning lands on the next unanswered step. */
export default function BrandAuditFlow({
  homeHref,
  initialStep,
  initialGoals,
  initialChallenges,
  complete,
  canEdit,
  readOnlyMessage,
  saveStep,
  completeAudit,
}: {
  homeHref: string;
  initialStep: AuditStep;
  initialGoals: AuditAnswer[];
  initialChallenges: AuditAnswer[];
  complete: boolean;
  canEdit: boolean;
  readOnlyMessage: string | null;
  saveStep: (kind: AuditKind, answers: { key: string; detail: string }[]) => Promise<ActionResult>;
  completeAudit: () => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [step, setStep] = useState<AuditStep>(canEdit ? initialStep : "review");
  const [goals, setGoals] = useState<AuditSelection>(() => toSelection(initialGoals));
  const [challenges, setChallenges] = useState<AuditSelection>(() => toSelection(initialChallenges));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const go = (next: AuditStep) => {
    setError(null);
    setStep(next);
    window.scrollTo({ top: 0 });
  };

  const save = (kind: AuditKind, then: () => void) =>
    startTransition(async () => {
      setError(null);
      const result = await saveStep(kind, toAnswers(kind === "goal" ? goals : challenges));
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

  const exit = (kind: AuditKind | null) => {
    const selection = kind === "goal" ? goals : kind === "challenge" ? challenges : null;
    if (!kind || !selection || Object.keys(selection).length === 0) {
      router.push(homeHref);
      return;
    }
    save(kind, () => {
      router.push(homeHref);
      router.refresh();
    });
  };

  const stepIndex = step === "goals" ? 1 : step === "challenges" ? 2 : step === "review" ? 3 : 0;

  return (
    <div className="flex flex-col gap-5">
      {stepIndex > 0 && (
        <div>
          <div className="flex items-center justify-between gap-3 text-metadata text-muted">
            <span>{step === "review" ? "Review" : `Step ${stepIndex} of 3`}</span>
            <Link href={homeHref} className="font-semibold text-muted hover:text-primary">
              {canEdit && step !== "review" ? "Cancel" : "Back To Home"}
            </Link>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/[0.06]" aria-hidden="true">
            <div className="h-full rounded-full bg-findmi transition-all" style={{ width: `${(stepIndex / 3) * 100}%` }} />
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
            <li className="flex items-center gap-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-findmi-50 text-metadata font-bold text-findmi-700">1</span>
              Your Goals
            </li>
            <li className="flex items-center gap-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-findmi-50 text-metadata font-bold text-findmi-700">2</span>
              Current Challenges
            </li>
          </ol>
          <p className="mt-3 text-metadata text-muted">About 3 minutes. Save anytime and come back later.</p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => go("goals")}
              className="flex h-12 items-center justify-center rounded-xl bg-findmi px-6 text-button font-bold text-white transition hover:bg-findmi-600"
            >
              Start Brand Audit
            </button>
            <Link href={homeHref} className="flex h-12 items-center justify-center rounded-xl border border-black/10 px-6 text-button font-semibold text-primary transition hover:border-black/20">
              Maybe Later
            </Link>
          </div>
        </div>
      )}

      {(step === "goals" || step === "challenges") && (
        <>
          <div>
            <h1 className="font-display text-page-title font-bold leading-tight text-primary">{COPY[step].title}</h1>
            <p className="mt-1 text-body text-muted">{COPY[step].copy}</p>
          </div>
          <AuditChoiceList
            keys={step === "goals" ? AUDIT_GOALS : AUDIT_CHALLENGES}
            options={step === "goals" ? AUDIT_GOAL_OPTIONS : AUDIT_CHALLENGE_OPTIONS}
            value={step === "goals" ? goals : challenges}
            onChange={step === "goals" ? setGoals : setChallenges}
            placeholder={COPY[step].placeholder}
            otherPlaceholder={COPY[step].other}
          />
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-metadata font-semibold text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => (step === "goals" ? go(complete ? "review" : "intro") : go("goals"))}
              className="flex h-12 items-center justify-center rounded-xl border border-black/10 px-4 text-button font-semibold text-primary transition hover:border-black/20"
            >
              Back
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => exit(step === "goals" ? "goal" : "challenge")}
              className="flex h-12 items-center justify-center rounded-xl px-3 text-button font-semibold text-muted transition hover:text-primary disabled:opacity-50"
            >
              Save &amp; Exit
            </button>
            <button
              type="button"
              disabled={pending || Object.keys(step === "goals" ? goals : challenges).length === 0}
              onClick={() => save(step === "goals" ? "goal" : "challenge", () => go(step === "goals" ? (complete ? "review" : "challenges") : "review"))}
              className="ml-auto flex h-12 flex-1 items-center justify-center rounded-xl bg-findmi px-5 text-button font-bold text-white transition hover:bg-findmi-600 disabled:opacity-40 sm:flex-none"
            >
              {pending ? "Saving…" : "Continue"}
            </button>
          </div>
        </>
      )}

      {step === "review" && (
        <>
          <div>
            <h1 className="font-display text-page-title font-bold leading-tight text-primary">{complete ? "Your Brand Audit" : "Review Your Brand Audit"}</h1>
            <p className="mt-1 text-body text-muted">
              {canEdit ? "You can update your answers anytime as your brand evolves." : readOnlyMessage}
            </p>
          </div>
          <ReviewSection title="Your Goals" kind="goal" selection={goals} onEdit={canEdit ? () => go("goals") : null} />
          <ReviewSection title="Current Challenges" kind="challenge" selection={challenges} onEdit={canEdit ? () => go("challenges") : null} />
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

function ReviewSection({ title, kind, selection, onEdit }: { title: string; kind: AuditKind; selection: AuditSelection; onEdit: (() => void) | null }) {
  const entries = AUDIT_KEYS[kind].filter((k) => k in selection).map((k) => [k, selection[k]] as const);
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
      {entries.length === 0 ? (
        <p className="mt-1.5 text-body text-muted">Not answered yet.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {entries.map(([key, detail]) => (
            <li key={key}>
              <p className="text-card-title font-semibold text-primary">{auditOptionLabel(kind, key)}</p>
              {detail.trim() && <p className="mt-0.5 whitespace-pre-line text-metadata text-secondary">{detail.trim()}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
