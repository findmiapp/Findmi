"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CommercialIntent, TargetKind } from "@/lib/commercial-intents";
import { INQUIRY_MESSAGE_MAX, INQUIRY_STATUS_LABELS, INQUIRY_STATUS_TONE, inquiryIntentChoices, intentLabel, isOpenInquiry, type InquiryStatus } from "@/lib/commercial-inquiries-domain";
import { sendInquiryAction } from "../../../inquiry-actions";
import { Chip } from "../../../owner-ui";

/** Inquiry — the deliberate step from a private Target to a shared Commercial
 * Inquiry (Findmi always in the conversation). Nothing is sent when a Target
 * is created; only this explicit Send does. The composer never pre-fills the
 * Target's private Context, and nothing private travels with it. An Event
 * Target's Event Participation goes to the Event's own application instead. */

export interface TargetInquirySummary {
  id: string;
  intent: CommercialIntent;
  status: InquiryStatus;
  conversationId: string | null;
  createdAt: string;
}

const sectionTitle = "text-label font-bold uppercase text-subtle";
const primaryBtn = "flex h-10 shrink-0 items-center whitespace-nowrap rounded-full bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600 disabled:opacity-50";
const quietBtn = "flex h-10 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-metadata font-semibold text-muted hover:text-primary disabled:opacity-50";

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(16).padStart(8, "0")}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`);

export default function InquiryPanel({
  businessId,
  senderName,
  targetId,
  kind,
  counterpartyId,
  counterpartyName,
  targetIntents,
  eventHref,
  inquiries,
  canEdit,
}: {
  businessId: string;
  senderName: string;
  targetId: string;
  kind: TargetKind;
  counterpartyId: string;
  counterpartyName: string;
  targetIntents: readonly CommercialIntent[];
  /** An Event Target's public page (where its application lives). */
  eventHref: string | null;
  inquiries: readonly TargetInquirySummary[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const { choices, preselected, participation } = inquiryIntentChoices(kind, targetIntents);
  const [composing, setComposing] = useState(false);
  const [intent, setIntent] = useState<CommercialIntent | "">(preselected ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  // One key per Send operation: a double tap or retry resolves to the same Inquiry.
  const [requestKey, setRequestKey] = useState(newKey);
  const [pending, start] = useTransition();

  const open = inquiries.find((i) => isOpenInquiry(i.status)) ?? null;
  const last = open ? null : (inquiries[0] ?? null);
  const href = (id: string) => `/account/business/${businessId}/inquiries/${id}`;

  const send = () =>
    start(async () => {
      setError(null);
      if (!intent) return setError("Choose one intent.");
      const result = await sendInquiryAction(businessId, { targetId, kind, counterpartyId, intent, message, requestKey });
      if (!result.ok) return setError(result.error);
      setComposing(false);
      setRequestKey(newKey());
      router.push(result.href);
    });

  return (
    <section aria-labelledby="ws-inquiry" className="flex flex-col gap-2">
      <h3 id="ws-inquiry" className={sectionTitle}>Inquiry</h3>

      {open ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/[0.08] bg-white px-3.5 py-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <Chip tone={INQUIRY_STATUS_TONE[open.status]}>{INQUIRY_STATUS_LABELS[open.status]}</Chip>
              <span className="text-body font-semibold text-primary">{intentLabel(open.intent)}</span>
            </p>
            <p className="mt-0.5 text-metadata text-muted">Shared with {counterpartyName} through Findmi · Conversation available</p>
          </div>
          <Link href={href(open.id)} className={primaryBtn}>
            Open Inquiry
          </Link>
        </div>
      ) : composing ? (
        <div className="flex flex-col gap-3 rounded-xl border border-black/[0.08] bg-white p-3.5">
          <div>
            <p className="font-display text-card-title font-bold text-primary">Send Inquiry</p>
            <p className="mt-0.5 text-metadata text-muted">
              You&rsquo;re asking Findmi to help connect {senderName} with {counterpartyName}
              {intent ? ` about a potential ${intentLabel(intent)}` : ""}.
            </p>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-metadata font-semibold text-muted">Intent</span>
            <select
              value={intent}
              disabled={pending}
              onChange={(e) => setIntent(e.target.value as CommercialIntent)}
              className="h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-input text-primary focus:border-findmi/50 focus:outline-none focus:ring-2 focus:ring-findmi/20"
            >
              {!preselected && <option value="">Choose one</option>}
              {choices.map((i) => (
                <option key={i} value={i}>
                  {intentLabel(i)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-metadata font-semibold text-muted">Message</span>
            <textarea
              autoCapitalize="sentences"
              value={message}
              disabled={pending}
              maxLength={INQUIRY_MESSAGE_MAX}
              rows={4}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Tell them what you're interested in…"
              className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-input text-primary placeholder:text-subtle focus:border-findmi/50 focus:outline-none focus:ring-2 focus:ring-findmi/20"
            />
          </label>
          <p className="text-microcopy text-subtle">They&rsquo;ll see {senderName}, the intent and this message. Your Target, Context, Next and Activity stay private.</p>
          {error && (
            <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-metadata font-semibold text-red-700">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1">
            <button type="button" onClick={send} disabled={pending || !intent || !message.trim()} className={primaryBtn}>
              {pending ? "Sending…" : "Send Inquiry"}
            </button>
            <button type="button" onClick={() => setComposing(false)} disabled={pending} className={quietBtn}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {last && (
            <p className="flex flex-wrap items-center gap-2 text-metadata text-muted">
              Last Inquiry
              <Chip tone={INQUIRY_STATUS_TONE[last.status]}>{INQUIRY_STATUS_LABELS[last.status]}</Chip>
              {intentLabel(last.intent)} ·
              <Link href={href(last.id)} className="font-semibold text-accent hover:underline">
                Open
              </Link>
            </p>
          )}
          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setComposing(true)} className={primaryBtn}>
                Send Inquiry
              </button>
              <span className="text-metadata text-muted">Ask Findmi to connect you. Nothing is sent until you do.</span>
            </div>
          ) : (
            <p className="text-metadata text-muted">Only an owner or manager can send an Inquiry.</p>
          )}
        </div>
      )}

      {participation && (
        <p className="text-metadata text-muted">
          Event Participation goes through the Event&rsquo;s own application.{" "}
          {eventHref ? (
            <Link href={eventHref} className="font-semibold text-accent hover:underline">
              Apply on the Event Page →
            </Link>
          ) : (
            "This Event isn't public yet."
          )}
        </p>
      )}
    </section>
  );
}
