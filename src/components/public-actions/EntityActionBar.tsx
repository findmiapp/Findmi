"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import InquireButton from "@/components/InquireButton";
import MessageButton from "@/components/MessageButton";
import type { BusinessInquiryTopic } from "@/lib/business-inquiry-topics";
import type { TargetKind } from "@/lib/commercial-intents";
import type { PublicActionView } from "@/lib/public-actions";
import { actionBarLayout, actionTitle, type PublicActionType } from "@/lib/public-actions-domain";
import { trackEvent } from "@/lib/analytics/track";
import {
  getPublicActionContextAction,
  openEntityOpportunitiesAction,
  startPublicActionAction,
  type ActingBusiness,
} from "@/app/(public)/account/public-actions-actions";

/** The public entity action bar — the ONE place a visitor engages with a
 * Business, Location or Event (Person later), set by that entity's managers
 * (Public Actions). 0 actions render nothing; 1 is full width; 2 or 3 are
 * equal columns. Visible to everyone, signed in or not.
 *
 * Each button keeps its own existing destination: General Inquiry is the
 * existing Inquire / Contact form; Event Participation the Event's existing
 * application; Website the entity's own saved site. Commercial actions and
 * Opportunities need a Business, so they open a small sheet: sign in (and
 * come straight back to this action), or choose which Business is reaching
 * out — never a list of the viewer's Businesses on the page itself. */
export default function EntityActionBar({
  kind,
  entityId,
  entityName,
  pagePath,
  actions,
  inquiryTopics,
  eventOccurrences,
  opportunityCount = 0,
  className = "",
  noRecipient = false,
}: {
  kind: TargetKind;
  entityId: string;
  entityName: string;
  /** This page's own path — where sign-in returns to continue the action. */
  pagePath: string;
  actions: PublicActionView[];
  /** Business only: its enabled Inquiry topics (the existing Inquire form). */
  inquiryTopics?: BusinessInquiryTopic[];
  /** Event only: dates the participation application can ask about. */
  eventOccurrences?: { id: string; startAt: string | null; date: string }[];
  /** Open Opportunities explicitly about this entity. */
  opportunityCount?: number;
  className?: string;
  /** Nobody manages this page on Findmi: a General Inquiry goes to Findmi
   * and says so (InquireButton's noRecipient). */
  noRecipient?: boolean;
}) {
  const [sheet, setSheet] = useState<{ slot: number; type: PublicActionType | "opportunities" } | null>(null);

  // Back from sign-in (?act=<slot> | ?act=opportunities): continue that action.
  useEffect(() => {
    let act: string | null = null;
    try {
      const url = new URL(window.location.href);
      act = url.searchParams.get("act");
      if (act) {
        url.searchParams.delete("act");
        window.history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
      }
    } catch {
      return;
    }
    if (act === "opportunities" && opportunityCount > 0) setSheet({ slot: 0, type: "opportunities" });
    const a = actions.find((x) => String(x.slot) === act && (x.route === "commercial_inquiry" || x.route === "opportunity"));
    if (a) setSheet({ slot: a.slot, type: a.type });
  }, [actions, opportunityCount]);

  if (!actions.length && !opportunityCount) return null;
  const { cols, compact } = actionBarLayout(actions.length);
  const grid = cols === 3 ? "grid-cols-3" : cols === 2 ? "grid-cols-2" : "grid-cols-1";
  const base = compact
    ? "flex h-12 w-full min-w-0 items-center justify-center rounded-2xl px-1.5 text-center text-[11px] font-bold uppercase leading-tight tracking-normal [text-wrap:balance] transition"
    : "flex h-12 w-full min-w-0 items-center justify-center rounded-2xl px-3 text-center text-sm font-bold uppercase leading-tight tracking-wide [text-wrap:balance] transition";
  // One treatment for every slot (the Native Rose outlined INQUIRE): no
  // action is promoted over another.
  const cls = `${base} border border-findmi/40 bg-white text-findmi-700 hover:bg-findmi-50`;
  // One analytics event family: canonical type + slot, never the label.
  const track = (a: PublicActionView) =>
    trackEvent({ event_name: "click_public_action", subject_type: kind, subject_id: entityId, [`${kind}_id`]: entityId, page_path: pagePath, metadata: { action_type: a.type, slot: a.slot } });

  return (
    <div className={className}>
      {actions.length > 0 && (
        <div className={`grid ${grid} gap-2`} data-public-actions={actions.length}>
          {actions.map((a) => (
            <div key={a.slot} className="flex min-w-0" onClickCapture={() => track(a)}>
              {renderAction(a)}
            </div>
          ))}
        </div>
      )}
      {opportunityCount > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-metadata text-muted">
          {opportunityCount === 1 ? "1 Opportunity" : `${opportunityCount} Opportunities`}
          <button type="button" onClick={() => setSheet({ slot: 0, type: "opportunities" })} className="flex min-h-10 items-center font-semibold text-accent hover:underline">
            Explore Opportunities
          </button>
        </p>
      )}
      {sheet && <ActionSheet kind={kind} entityId={entityId} entityName={entityName} pagePath={pagePath} sheet={sheet} onClose={() => setSheet(null)} />}
    </div>
  );

  function renderAction(a: PublicActionView) {
    if (a.route === "general_inquiry")
      return <InquireButton targetType={kind} targetId={entityId} targetName={entityName} label={a.label} topics={kind === "business" ? inquiryTopics : undefined} className={cls} noRecipient={noRecipient} />;
    if (a.route === "event_participation")
      return <MessageButton targetType="event" targetId={entityId} targetName={entityName} label={a.label} eventOccurrences={eventOccurrences} triggerClassName={cls} />;
    if (a.route === "website" && a.href)
      return (
        <a href={a.href} target="_blank" rel="noreferrer" className={cls}>
          {a.label}
        </a>
      );
    return (
      <button type="button" onClick={() => setSheet({ slot: a.slot, type: a.type })} className={cls}>
        {a.label}
      </button>
    );
  }
}

function ActionSheet({
  kind,
  entityId,
  entityName,
  pagePath,
  sheet,
  onClose,
}: {
  kind: TargetKind;
  entityId: string;
  entityName: string;
  pagePath: string;
  sheet: { slot: number; type: PublicActionType | "opportunities" };
  onClose: () => void;
}) {
  const router = useRouter();
  const [ctx, setCtx] = useState<{ signedIn: boolean; businesses: ActingBusiness[] } | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const isOpps = sheet.type === "opportunities";
  const commercial = !isOpps && sheet.type !== "opportunity";
  const title = isOpps ? "Explore Opportunities" : actionTitle(sheet.type as PublicActionType);
  const next = `${pagePath}?act=${isOpps ? "opportunities" : sheet.slot}`;

  useEffect(() => {
    let live = true;
    getPublicActionContextAction(kind, entityId)
      .then((c) => {
        if (!live) return;
        setCtx(c);
        if (c.businesses.length === 1) setChosen(c.businesses[0].id);
      })
      .catch(() => live && setCtx({ signedIn: false, businesses: [] }));
    return () => {
      live = false;
    };
  }, [kind, entityId]);

  const acting = ctx?.businesses.find((b) => b.id === chosen) ?? null;
  const proceed = () =>
    start(async () => {
      if (!chosen) return;
      setError(null);
      const res = isOpps ? await openEntityOpportunitiesAction(chosen, kind, entityId) : await startPublicActionAction(chosen, kind, entityId, sheet.slot);
      if (!res.ok) return setError(res.error);
      router.push(res.href);
    });

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
      <div onClick={onClose} className="fixed inset-0 bg-black/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${title}: ${entityName}`}
        className="relative w-full max-h-[85vh] overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-xl sm:max-w-sm sm:rounded-3xl sm:pb-5"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink">
            {title}: {entityName}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink/50 transition hover:bg-black/[0.03] hover:text-ink">
            ×
          </button>
        </div>

        {!ctx ? (
          <p className="mt-4 text-sm text-ink/50">One moment…</p>
        ) : !ctx.signedIn ? (
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-sm text-ink/60">Sign in to continue as your Business. You&rsquo;ll come right back to this.</p>
            <div className="grid grid-cols-2 gap-2">
              <Link href={`/login?next=${encodeURIComponent(next)}`} className="flex h-11 items-center justify-center rounded-2xl bg-findmi text-sm font-bold text-white hover:bg-findmi-600">
                Log In
              </Link>
              <Link href={`/signup?next=${encodeURIComponent(next)}`} className="flex h-11 items-center justify-center rounded-2xl border border-black/10 text-sm font-bold text-ink hover:border-ink/30">
                Create Account
              </Link>
            </div>
          </div>
        ) : !ctx.businesses.length ? (
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-sm text-ink/60">{commercial ? "Inquiries are sent from a Business on Findmi." : "Opportunities are for Businesses on Findmi."} Add yours to continue.</p>
            <Link href="/account/business/new" className="flex h-11 items-center justify-center rounded-2xl bg-findmi text-sm font-bold text-white hover:bg-findmi-600">
              Add Your Business
            </Link>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            {ctx.businesses.length > 1 ? (
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1.5 text-sm font-semibold text-ink">Which Business are you contacting them as?</legend>
                {ctx.businesses.map((b) => (
                  <label key={b.id} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2 text-sm ${chosen === b.id ? "border-findmi bg-findmi-50" : "border-black/10"}`}>
                    <input type="radio" name="acting-business" checked={chosen === b.id} onChange={() => setChosen(b.id)} className="h-4 w-4 accent-findmi" />
                    <span className="min-w-0 truncate font-medium text-ink">{b.name}</span>
                  </label>
                ))}
              </fieldset>
            ) : (
              <p className="text-sm text-ink/60">
                As <span className="font-semibold text-ink">{ctx.businesses[0].name}</span>
              </p>
            )}
            {acting?.status && acting.relationshipHref && (
              <p className="text-xs text-ink/50">
                {acting.status} ·{" "}
                <Link href={acting.relationshipHref} className="font-semibold text-findmi-700 hover:underline">
                  Open Relationship
                </Link>
              </p>
            )}
            <p className="text-xs text-ink/50">{commercial ? "Next, write your message. Nothing is sent until you send it." : "Opens the Opportunity on Findmi."}</p>
            {error && (
              <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-semibold text-red-700">
                {error}
              </p>
            )}
            <button type="button" onClick={proceed} disabled={!chosen || pending} className="flex h-11 items-center justify-center rounded-2xl bg-findmi text-sm font-bold text-white hover:bg-findmi-600 disabled:opacity-50">
              {pending ? "One moment…" : "Continue"}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
