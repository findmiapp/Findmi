"use client";

import Link from "next/link";
import { NotPublicBadge } from "@/components/places/PlaceFindOrCreate";
import { TARGET_KIND_LABELS } from "@/lib/business-targets-domain";
import type { BusinessTargetItem, TargetActivityPage } from "@/lib/business-targets";
import { Chip } from "../../../owner-ui";
import { ActivityFeed, IntentsBlock, InternalNotes, NextCard, StatusControl, SummaryBlock } from "./RelationshipWorkspace";
import { LockIcon, TargetThumb } from "./TargetsView";
import InquiryPanel, { type TargetInquirySummary } from "./InquiryPanel";

/** One Business or Event Target — the same private pursuit as a Place Target
 * (status, Next, Context, Why, Activity, Findmi Internal), without the
 * place-only sections (Presence, Appearances Here). Addressed by the Target
 * (`tgt`). Targeting an Event is about THAT Event; its organizer is a separate
 * Business Target. Nothing here is visible to the counterparty. Owners and
 * managers edit; staff read. */
export default function TargetWorkspace({
  businessId,
  target,
  canEdit,
  isFindmiAdmin,
  internalNotes,
  activity,
  inquiries,
  senderName,
  backHref,
  backLabel,
}: {
  businessId: string;
  target: BusinessTargetItem;
  canEdit: boolean;
  /** A founder Admin session — the only viewer of Findmi Internal. */
  isFindmiAdmin: boolean;
  internalNotes: string | null;
  activity: TargetActivityPage | null;
  /** This Business's Inquiries from this Target (sender side). */
  inquiries: TargetInquirySummary[];
  senderName: string;
  backHref: string;
  backLabel: string;
}) {
  const c = target.counterparty;
  return (
    <div className="flex flex-col gap-5 lg:max-w-3xl">
      <Link href={backHref} scroll={false} className="-my-2 inline-flex min-h-10 w-fit items-center gap-1 text-metadata font-semibold text-accent hover:underline">
        <span aria-hidden="true">←</span> {backLabel}
      </Link>

      {/* relative: on phones the status picker opens under the whole header, never off-screen. */}
      <header className="relative flex items-start gap-3">
        <TargetThumb imageUrl={c.imageUrl} kind={target.kind} />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-card-title-lg font-bold leading-snug text-primary">{c.name}</h2>
          <p className="text-metadata text-muted">{[TARGET_KIND_LABELS[target.kind], c.subtitle].filter(Boolean).join(" · ")}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <StatusControl businessId={businessId} item={target} canEdit={canEdit} />
            {c.notPublic && <NotPublicBadge />}
            {c.archived && <Chip tone="neutral">No Longer On Findmi</Chip>}
            <span className="inline-flex items-center gap-1 text-microcopy text-subtle" title="Private to your team and Findmi">
              <LockIcon className="h-3 w-3" /> Private
            </span>
          </div>
          {c.href && (
            <Link href={c.href} className="mt-1 inline-flex min-h-10 items-center text-metadata font-semibold text-accent hover:underline">
              View {target.kind === "event" ? "Event" : "Profile"} →
            </Link>
          )}
        </div>
      </header>

      <NextCard businessId={businessId} item={target} canEdit={canEdit} />
      {!c.archived && (
        <InquiryPanel
          businessId={businessId}
          senderName={senderName}
          targetId={target.id}
          kind={target.kind}
          counterpartyId={c.id}
          counterpartyName={c.name}
          targetIntents={target.intents}
          eventHref={target.kind === "event" ? c.href : null}
          inquiries={inquiries}
          canEdit={canEdit}
        />
      )}
      <SummaryBlock businessId={businessId} item={target} canEdit={canEdit} />
      <IntentsBlock businessId={businessId} item={target} canEdit={canEdit} />
      <ActivityFeed businessId={businessId} targetId={target.id} canAdd={canEdit} initial={activity} />
      {isFindmiAdmin && <InternalNotes businessId={businessId} targetId={target.id} initial={internalNotes} />}
    </div>
  );
}
