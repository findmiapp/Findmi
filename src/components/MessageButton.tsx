"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  applyToEventPublic,
  inviteBusinessToEventPublic,
  messageBusiness,
  messageEventOrganizer,
  messageLocation,
} from "@/app/(public)/connect/actions";

// FINDMI — Messaging UX Unification pass. The ONE public communication
// entry point on every entity page (Event/Business/Location) — Section 1's
// locked product rule: a single MESSAGE affordance, never "Connect." The
// modal opens directly to the composer (Section 8 — plain messaging is the
// default state, not one choice in a menu); Apply to Vend / Invite to
// Event are one-tap MODE SWITCHES inside the SAME modal, never a separate
// screen or a second dialog. Renamed from the prior ConnectButton — same
// underlying Server Actions (connect/actions.ts, unchanged), only the
// entry-point UI/copy changed.
//
// State is fetched from /api/account/connect on mount (unchanged) — one
// small GET, no conversation history, no Messages inbox data, no
// Event/Business dataset beyond the viewer's own managed-entity list
// (Section 7's own performance requirement).

type ViewerState = {
  authenticated: boolean;
  emailVerified: boolean;
  businesses: { id: string; name: string }[];
  events: { id: string; name: string }[];
};

type ActorOption = { kind: "business" | "event"; id: string; name: string };

/** "message" is always the default/entry mode (Section 8) — "apply"/
 * "invite" are reached by tapping the secondary contextual link inside
 * the same modal, never a leading action menu. */
type Mode = "message" | "apply" | "invite";

export default function MessageButton({
  targetType,
  targetId,
  targetName,
  eventOccurrences,
}: {
  targetType: "event" | "business" | "location";
  targetId: string;
  targetName: string;
  /** Event target only — lets "Apply to Vend" ask which date on a
   * recurring event. Omitted (or empty) for a non-recurring event, which
   * applies to the whole event exactly as before. */
  eventOccurrences?: { id: string; startAt: string }[];
}) {
  const router = useRouter();
  const [state, setState] = useState<ViewerState | "loading">("loading");
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<Mode>("message");
  const [actorId, setActorId] = useState<string>("");
  const [occurrenceId, setOccurrenceId] = useState<string>("");
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

  // One small GET on mount — auth state + this viewer's OWN managed
  // Businesses/Events, nothing else. No conversation/Opportunity data is
  // fetched until a send/apply/invite actually happens.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/account/connect")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ViewerState | null) => {
        if (!cancelled) setState(data ?? { authenticated: false, emailVerified: false, businesses: [], events: [] });
      })
      .catch(() => {
        if (!cancelled) setState({ authenticated: false, emailVerified: false, businesses: [], events: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  if (state === "loading") return null;

  const actorOptions: ActorOption[] =
    targetType === "business"
      ? [
          ...state.businesses.filter((b) => b.id !== targetId).map((b) => ({ kind: "business" as const, id: b.id, name: b.name })),
          ...state.events.map((e) => ({ kind: "event" as const, id: e.id, name: e.name })),
        ]
      : state.businesses.map((b) => ({ kind: "business" as const, id: b.id, name: b.name }));

  function reset() {
    setMode("message");
    setActorId(actorOptions[0]?.id ?? "");
    setOccurrenceId("");
    setBody("");
    setNote("");
    setError(null);
  }

  function openModal() {
    reset();
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setSubmitting(false);
    buttonRef.current?.focus();
  }

  const selectedActor = actorOptions.find((a) => a.id === actorId) ?? actorOptions[0] ?? null;
  const canApply = targetType === "event"; // businesses only — actorOptions is already business-only for an Event target
  const canInvite = targetType === "business" && selectedActor?.kind === "event";

  async function submitMessage() {
    if (!selectedActor || !body.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const result =
        targetType === "event"
          ? await messageEventOrganizer(targetId, selectedActor.id, body)
          : targetType === "location"
            ? await messageLocation(targetId, selectedActor.id, body)
            : await messageBusiness(targetId, selectedActor.kind, selectedActor.id, body);
      if ("error" in result) {
        setError(result.error);
        setSubmitting(false);
      } else {
        router.push(`/account/messages/${result.conversationId}`);
      }
    } catch {
      setError("Couldn't send that message. Please try again.");
      setSubmitting(false);
    }
  }

  async function submitApply() {
    if (!selectedActor) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await applyToEventPublic(targetId, occurrenceId || null, selectedActor.id, note);
      if ("error" in result) {
        setError(result.error);
        setSubmitting(false);
      } else {
        router.push(`/account/messages/${result.conversationId}`);
      }
    } catch {
      setError("Couldn't submit that application. Please try again.");
      setSubmitting(false);
    }
  }

  async function submitInvite() {
    if (!selectedActor) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await inviteBusinessToEventPublic(selectedActor.id, targetId, note);
      if ("error" in result) {
        setError(result.error);
        setSubmitting(false);
      } else {
        router.push(`/account/messages/${result.conversationId}`);
      }
    } catch {
      setError("Couldn't send that invite. Please try again.");
      setSubmitting(false);
    }
  }

  const nextParam = typeof window !== "undefined" ? `?next=${encodeURIComponent(window.location.pathname)}` : "";

  return (
    <>
      {/* Section 1/12 — compact rounded RECTANGLE (not a pill), chat-bubble
          icon, "MESSAGE" label. Deliberately not full-width and not
          rounded-full — this is the one visual departure from the site's
          usual pill buttons, so it never reads as another Follow/Save. */}
      <button
        ref={buttonRef}
        type="button"
        onClick={openModal}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-findmi/40 bg-white px-2 text-[10px] font-bold uppercase tracking-tight text-findmi-700 transition hover:bg-findmi-50"
      >
        <ChatGlyph className="h-3.5 w-3.5 shrink-0" />
        Message
      </button>

      {mounted &&
        open &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
            <div onClick={close} className="fixed inset-0 bg-black/40" />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`Message ${targetName}`}
              className="relative w-full max-h-[85vh] overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-xl sm:max-w-sm sm:rounded-3xl sm:pb-5"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-display text-lg font-bold tracking-tight text-ink">Message {targetName}</h2>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink/50 transition hover:bg-black/[0.03] hover:text-ink"
                >
                  <CloseGlyph className="h-4 w-4" />
                </button>
              </div>

              {!state.authenticated ? (
                <div className="mt-4">
                  <p className="text-sm text-ink/60">Sign in with your free Findmi account to message on Findmi.</p>
                  <a
                    href={`/login${nextParam}`}
                    className="mt-3 flex h-11 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
                  >
                    Sign In
                  </a>
                </div>
              ) : !state.emailVerified ? (
                <div className="mt-4">
                  <p className="text-sm text-ink/60">Verify your email before you can message on Findmi.</p>
                  <a
                    href={`/account/verify-email${nextParam}`}
                    className="mt-3 flex h-11 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
                  >
                    Verify Email
                  </a>
                </div>
              ) : actorOptions.length === 0 ? (
                <div className="mt-4">
                  <p className="text-sm text-ink/60">
                    {targetType === "event"
                      ? "You need a Business on Findmi to message organizers."
                      : "You need a Business or Event on Findmi to send a message."}
                  </p>
                  <Link
                    href="/account/business/new"
                    className="mt-3 flex h-11 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
                  >
                    Create a Business
                  </Link>
                </div>
              ) : (
                <div className="mt-4 flex flex-col gap-3">
                  {/* Identity selector — only shown when the viewer manages
                      more than one eligible entity (Section 2's own "do
                      not force identity selection" rule). */}
                  {actorOptions.length > 1 && (
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-ink">Message as</span>
                      <select
                        value={actorId}
                        onChange={(e) => {
                          setActorId(e.target.value);
                          setMode("message");
                        }}
                        className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink focus:border-ink/30 focus:outline-none"
                      >
                        {actorOptions.map((a) => (
                          <option key={`${a.kind}:${a.id}`} value={a.id}>
                            {a.kind === "business" ? "Business" : "Event"} — {a.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {mode === "message" && (
                    <div className="flex flex-col gap-3">
                      <textarea
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        rows={4}
                        placeholder={`Write a message to ${targetName}…`}
                        className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
                      />
                      {error && <p className="text-xs text-red-600">{error}</p>}
                      <button
                        type="button"
                        onClick={submitMessage}
                        disabled={submitting || !body.trim()}
                        className="flex h-12 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-60"
                      >
                        {submitting ? "…" : "Send"}
                      </button>

                      {/* Section 8 — the secondary contextual action, a
                          one-tap mode switch inside this SAME modal, never
                          a separate dialog. */}
                      {canApply && (
                        <button
                          type="button"
                          onClick={() => {
                            setMode("apply");
                            setError(null);
                          }}
                          className="text-center text-xs font-semibold text-findmi-700 underline underline-offset-2 hover:text-findmi-600"
                        >
                          Apply to Vend instead
                        </button>
                      )}
                      {canInvite && (
                        <button
                          type="button"
                          onClick={() => {
                            setMode("invite");
                            setError(null);
                          }}
                          className="text-center text-xs font-semibold text-findmi-700 underline underline-offset-2 hover:text-findmi-600"
                        >
                          Invite to Event instead
                        </button>
                      )}
                    </div>
                  )}

                  {mode === "apply" && (
                    <div className="flex flex-col gap-3">
                      {eventOccurrences && eventOccurrences.length > 0 && (
                        <label className="block">
                          <span className="mb-1.5 block text-xs font-medium text-ink">Date</span>
                          <select
                            value={occurrenceId}
                            onChange={(e) => setOccurrenceId(e.target.value)}
                            className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink focus:border-ink/30 focus:outline-none"
                          >
                            <option value="">Whole event</option>
                            {eventOccurrences.map((o) => (
                              <option key={o.id} value={o.id}>
                                {new Date(o.startAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={3}
                        placeholder="Optional message to the organizer…"
                        className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
                      />
                      {error && <p className="text-xs text-red-600">{error}</p>}
                      <button
                        type="button"
                        onClick={submitApply}
                        disabled={submitting}
                        className="flex h-12 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-60"
                      >
                        {submitting ? "…" : "Apply to Vend"}
                      </button>
                      <button type="button" onClick={() => setMode("message")} className="text-center text-xs font-semibold text-ink/50 transition hover:text-ink">
                        ← Back to message
                      </button>
                    </div>
                  )}

                  {mode === "invite" && (
                    <div className="flex flex-col gap-3">
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={3}
                        placeholder={`Optional message to ${targetName}…`}
                        className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
                      />
                      {error && <p className="text-xs text-red-600">{error}</p>}
                      <button
                        type="button"
                        onClick={submitInvite}
                        disabled={submitting}
                        className="flex h-12 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-60"
                      >
                        {submitting ? "…" : "Send Invite"}
                      </button>
                      <button type="button" onClick={() => setMode("message")} className="text-center text-xs font-semibold text-ink/50 transition hover:text-ink">
                        ← Back to message
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function ChatGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M4 5.5h16a1 1 0 011 1V15a1 1 0 01-1 1H9l-4 3.5V16H4a1 1 0 01-1-1V6.5a1 1 0 011-1z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
