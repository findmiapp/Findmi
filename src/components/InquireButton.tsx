"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { submitEntityInquiry, submitProductInquiry } from "@/app/(public)/connect/actions";
import { BUSINESS_INQUIRY_TOPIC_LABELS, type BusinessInquiryTopic } from "@/lib/business-inquiry-topics";

// Unify Site-Wide Communications pass — the ONE controlled public
// inquiry entry point (Business Inquire / Event Contact Organizer /
// Venue Contact). Deliberately separate from MessageButton (DIRECT
// MESSAGE — entity-to-entity, requires an authenticated managed entity):
// this is always available to a signed-in consumer OR a true guest, no
// account required (Phase 9/10's own product rule). Submitting creates a
// real Findmi Conversation (see connect/actions.ts's submitEntityInquiry
// / lib/opportunities.ts's createInquiryConversation) — never a second
// inbox — but a guest has no /account/messages to view it in, so this
// shows an inline success state in the SAME modal instead of navigating
// anywhere, regardless of whether the sender happens to be signed in.
//
// Business-Controlled Inquiry Settings pass — `topics` is now the
// Business's OWN currently-enabled stable values (never a hardcoded
// universal list — the caller, BusinessPublicView, already filtered to
// only what the owner turned on via sanitizeBusinessInquiryTopics).
// Exactly one enabled topic auto-selects it (shown as plain context
// text, no picker); more than one shows a small set of selectable rows
// — never a native <select>, which read as visually inconsistent with
// Findmi on Android (see this pass's own report) — built from existing
// Findmi control styling, no new dependency.

export default function InquireButton({
  targetType,
  targetId,
  targetName,
  label = "Inquire",
  topics,
  productId,
  className,
}: {
  targetType: "business" | "event" | "location";
  targetId: string;
  targetName: string;
  label?: string;
  /** Business only — the Business's own currently-enabled topics (already
   * filtered server-side by the caller). Omit for Event/Location, which
   * have no topic concept. */
  topics?: BusinessInquiryTopic[];
  /** Product Inquiry Consolidation pass — when set, submits via
   * submitProductInquiry instead of submitEntityInquiry (targetType stays
   * "business": the Product's own selling Business is still who receives
   * and manages this Conversation; the Product is carried as context, not
   * as a different kind of recipient). Business-only, same as `topics`. */
  productId?: string;
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [topic, setTopic] = useState<BusinessInquiryTopic | "">(topics?.[0] ?? "");
  const [message, setMessage] = useState("");
  const [companySite, setCompanySite] = useState(""); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function openModal() {
    setError(null);
    setSent(false);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setSubmitting(false);
    buttonRef.current?.focus();
  }

  const needsTopicChoice = Boolean(topics && topics.length > 1);
  const canSubmit = Boolean(name.trim() && email.trim() && message.trim() && (!needsTopicChoice || topic));

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = productId
        ? await submitProductInquiry({
            productId,
            name,
            email,
            phone: phone || undefined,
            message,
            companySite: companySite || undefined,
          })
        : await submitEntityInquiry({
            targetType,
            targetId,
            name,
            email,
            phone: phone || undefined,
            topic: topics ? topic || undefined : undefined,
            message,
            companySite: companySite || undefined,
          });
      if ("error" in result) {
        setError(result.error);
        setSubmitting(false);
      } else {
        setSent(true);
        setSubmitting(false);
      }
    } catch {
      setError("Couldn't send your message. Please try again.");
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";
  const labelClass = "mb-1.5 block text-xs font-medium text-ink";

  return (
    <>
      <button ref={buttonRef} type="button" onClick={openModal} className={className}>
        {label}
      </button>

      {mounted &&
        open &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
            <div onClick={close} className="fixed inset-0 bg-black/40" />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`${label} — ${targetName}`}
              className="relative w-full max-h-[85vh] overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-xl sm:max-w-sm sm:rounded-3xl sm:pb-5"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-display text-lg font-bold tracking-tight text-ink">
                  {sent ? "Message sent" : `${label} — ${targetName}`}
                </h2>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink/50 transition hover:bg-black/[0.03] hover:text-ink"
                >
                  <CloseGlyph className="h-4 w-4" />
                </button>
              </div>

              {sent ? (
                <div className="mt-4">
                  <p className="text-sm text-ink/60">
                    Thanks — we&rsquo;ll be in touch. Your message was sent to {targetName} on Findmi.
                  </p>
                  <button
                    type="button"
                    onClick={close}
                    className="mt-4 flex h-11 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <div className="mt-4 flex flex-col gap-3">
                  {/* Honeypot — hidden from real visitors, never a field a
                      person would recognize; see submitEntityInquiry's
                      own note on how a filled value is handled. */}
                  <div className="absolute -left-[9999px] top-auto h-0 w-0 overflow-hidden" aria-hidden="true">
                    <label>
                      Leave this field blank
                      <input
                        type="text"
                        tabIndex={-1}
                        autoComplete="off"
                        value={companySite}
                        onChange={(e) => setCompanySite(e.target.value)}
                      />
                    </label>
                  </div>

                  <label className="block">
                    <span className={labelClass}>Name</span>
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
                  </label>
                  <label className="block">
                    <span className={labelClass}>Email</span>
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
                  </label>
                  {topics && topics.length === 1 && (
                    // Single enabled topic — auto-selected (see `topic`'s
                    // initial state above), shown as plain context text
                    // rather than a one-item picker.
                    <p className="text-xs text-ink/45">
                      Topic: <span className="font-medium text-ink/70">{BUSINESS_INQUIRY_TOPIC_LABELS[topics[0]]}</span>
                    </p>
                  )}
                  {topics && topics.length > 1 && (
                    <div className="block">
                      <span className={labelClass}>Inquiry topic</span>
                      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Inquiry topic">
                        {topics.map((t) => {
                          const selected = topic === t;
                          return (
                            <button
                              key={t}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              onClick={() => setTopic(t)}
                              className={`rounded-full border px-3.5 py-2 text-xs font-semibold transition ${
                                selected
                                  ? "border-findmi bg-findmi-50 text-findmi-700"
                                  : "border-black/10 bg-white text-ink/60 hover:border-black/20"
                              }`}
                            >
                              {BUSINESS_INQUIRY_TOPIC_LABELS[t]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <label className="block">
                    <span className={labelClass}>Message</span>
                    <textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      rows={4}
                      placeholder={`Write a message to ${targetName}…`}
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span className={labelClass}>Phone (optional)</span>
                    <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
                  </label>

                  {error && <p className="text-xs text-red-600">{error}</p>}
                  <button
                    type="button"
                    onClick={submit}
                    disabled={submitting || !canSubmit}
                    className="flex h-12 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-60"
                  >
                    {submitting ? "Sending…" : "Send"}
                  </button>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function CloseGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
