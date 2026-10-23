"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useBusinesses } from "@/components/BusinessesContext";
import { Chip } from "@/app/(public)/account/owner-ui";
import { getEntityRelationshipsAction } from "@/app/(public)/account/relationship-actions";
import type { EntityRelationship } from "@/lib/relationship-context";
import type { TargetKind } from "@/lib/commercial-intents";
import { TARGET_STATUS_LABELS } from "@/lib/business-targets-domain";
import { INQUIRY_STATUS_LABELS, INQUIRY_STATUS_TONE, intentLabel } from "@/lib/commercial-inquiries-domain";
import { RELATIONSHIP_ACTIONS } from "@/lib/relationship-links";
import ConnectControl from "./ConnectControl";
import ContextualOpportunityList from "./ContextualOpportunityList";

/** For Your Business — the commercial layer of a public Place / Business /
 * Event page, for signed-in Business managers only. The consumer page above
 * it is unchanged; anonymous visitors and people who manage no Business get
 * nothing (not even the request — useBusinesses() is empty for them).
 *
 * Everything here is the viewer's OWN, read server-side for that viewer
 * (getEntityRelationshipsAction): each of their Businesses' private Target
 * state, its open Inquiries and Opportunities about this entity. With more
 * than one Business, each is listed by name with its own action — Findmi
 * never picks one silently. A Business never relates to itself.
 *
 * Event participation (`participate`) is the Event's existing Apply To
 * Participate workflow, passed in by the page and kept apart from Connect.
 *
 * Open To (future): what this entity is open to would sit beside the state
 * here once it exists. Nothing is shown for it today — never a fake value. */
const CONNECT_PROMPT: Record<TargetKind, string> = {
  location: "Interested in working with this Place?",
  business: "Interested in working together?",
  event: "Interested in sponsoring, sampling or activating here?",
};

export default function ForYourBusiness({
  kind,
  entityId,
  entityName,
  participate,
  className = "",
}: {
  kind: TargetKind;
  entityId: string;
  entityName: string;
  participate?: ReactNode;
  className?: string;
}) {
  const businesses = useBusinesses();
  const eligible = businesses.filter((b) => !(kind === "business" && b.id === entityId));
  const manages = eligible.length > 0;
  const [rows, setRows] = useState<EntityRelationship[] | null>(null);

  useEffect(() => {
    if (!manages) return;
    let live = true;
    getEntityRelationshipsAction(kind, entityId)
      .then((r) => live && setRows(r))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [kind, entityId, manages]);

  if (!manages || !rows || !rows.length) return null;
  const many = rows.length > 1;

  return (
    <section id="for-your-business" aria-labelledby="for-your-business-title" className={`scroll-mt-24 rounded-2xl border border-findmi/25 bg-findmi-50/40 p-4 ${className}`}>
      <h2 id="for-your-business-title" className="font-display text-section-title font-bold text-primary">
        For Your Business
      </h2>
      <p className="mt-1 text-metadata text-muted">Private to your team and Findmi — {entityName} isn&rsquo;t told.</p>

      <ul className="mt-3 flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.businessId} className="flex flex-col gap-2 rounded-xl border border-black/[0.08] bg-white p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 truncate text-body font-bold text-primary">{many ? r.businessName : `As ${r.businessName}`}</span>
              {r.status && <Chip tone="aquaSoft">{TARGET_STATUS_LABELS[r.status]}</Chip>}
            </div>
            {!r.status && !r.inquiries.length && r.canEdit && <p className="text-metadata text-secondary">{CONNECT_PROMPT[kind]}</p>}
            {r.inquiries.map((q) => (
              <p key={q.id} className="flex flex-wrap items-center gap-1.5 text-metadata font-semibold text-primary">
                {intentLabel(q.intent)} Inquiry ·<Chip tone={INQUIRY_STATUS_TONE[q.status]}>{INQUIRY_STATUS_LABELS[q.status]}</Chip>
              </p>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              {r.href && (r.status || r.inquiries.length > 0) ? (
                <Link href={r.href} className="flex h-10 items-center rounded-full bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600">
                  {RELATIONSHIP_ACTIONS.open}
                </Link>
              ) : r.canEdit ? (
                <ConnectControl businessId={r.businessId} kind={kind} counterpartyId={entityId} />
              ) : (
                <p className="text-metadata text-muted">An owner or manager can Connect.</p>
              )}
            </div>
            {r.opportunities.length > 0 && <ContextualOpportunityList items={r.opportunities} />}
          </li>
        ))}
      </ul>

      {participate && (
        <div className="mt-3 flex flex-col items-start gap-2 rounded-xl border border-black/[0.08] bg-white p-3.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <p className="min-w-0 text-metadata text-muted sm:flex-1">Taking part? Apply to the organizer — separate from Connect.</p>
          {participate}
        </div>
      )}
    </section>
  );
}
