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

// FINDMI — Public Messaging V1. The one shared "Connect" entry point for
// every public entity page (Event/Business/Location) — Section 15's own
// UX principle: a single primary affordance ("Connect"), which then
// reveals the contextual actions (Message / Apply to Event / Invite to
// Event) inside a compact drawer, never a cluster of competing buttons on
// the page itself. Deliberately one component parametrized by
// `targetType` rather than three near-duplicate ones — the acting-identity
// selection, verification/auth gating, and drawer chrome are identical
// across all three target types; only which actions are offered (and
// which of the viewer's managed entities may act) differs.
//
// State is fetched from /api/account/connect (mirrors ClaimButton's own
// "poll a small GET on mount" convention) — never assumes an identity;
// every actual send/apply/invite is independently re-verified server-side
// (requireBusinessMember/requireEventMember — see connect/actions.ts).

type ViewerState = {
  authenticated: boolean;
  emailVerified: boolean;
  businesses: { id: string; name: string }[];
  events: { id: string; name: string }[];
};

type ActorOption = { kind: "business" | "event"; id: string; name: string };

type View = "menu" | "message" | "apply" | "invite";

export default function ConnectButton({
  targetType,
  targetId,
  targetName,
  eventOccurrences,
}: {
  targetType: "event" | "business" | "location";
  targetId: string;
  targetName: string;
  /** Event target only — lets "Apply to Participate" ask which date on a
   * recurring event, mirroring the existing Business Manager apply flow's
   * own event/occurrence choice. Omitted (or empty) for a non-recurring
   * event, which applies to the whole event exactly as before. */
  eventOccurrences?: { id: string; startAt: string }[];
}) {
  const router = useRouter();
  const [state, setState] = useState<ViewerState | "loading">("loading");
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<View>("menu");
  const [actorId, setActorId] = useState<string>("");
  const [occurrenceId, setOccurrenceId] = useState<string>("");
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

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
    targetType === "event"
      ? state.businesses.map((b) => ({ kind: "business" as const, id: b.id, name: b.name }))
      : targetType === "location"
        ? state.businesses.map((b) => ({ kind: "business" as const, id: b.id, name: b.name }))
        : [
            ...state.businesses.filter((b) => b.id !== targetId).map((b) => ({ kind: "business" as const, id: b.id, name: b.name })),
            ...state.events.map((e) => ({ kind: "event" as const, id: e.id, name: e.name })),
          ];

  function reset() {
    setView("menu");
    setActorId(actorOptions[0]?.id ?? "");
    setOccurrenceId("");
    setBody("");
    setNote("");
    setError(null);
  }

  function openDrawer() {
    reset();
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setSubmitting(false);
    buttonRef.current?.focus();
  }

  const selectedActor = actorOptions.find((a) => a.id === actorId) ?? actorOptions[0] ?? null;

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
      <button
        ref={buttonRef}
        type="button"
        onClick={openDrawer}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex h-10 items-center justify-center rounded-full border border-findmi/40 px-4 text-xs font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-findmi-50"
      >
        Connect
      </button>

      {mounted &&
        open &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
            <div onClick={close} className="fixed inset-0 bg-black/40" />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`Connect with ${targetName}`}
              className="relative w-full max-h-[85vh] overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-xl sm:max-w-sm sm:rounded-3xl sm:pb-5"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-display text-lg font-bold tracking-tight text-ink">Connect with {targetName}</h2>
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
                  <p className="text-sm text-ink/60">Sign in with your free Findmi account to connect.</p>
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
                      ? "You need a Business on Findmi to connect with organizers."
                      : "You need a Business or Event on Findmi to connect."}
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
                  {actorOptions.length > 1 && (
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-ink">Messaging as</span>
                      <select
                        value={actorId}
                        onChange={(e) => setActorId(e.target.value)}
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

                  {view === "menu" && (
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => setView("message")}
                        className="flex h-11 items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
                      >
                        {targetType === "event" ? "Message Organizer" : `Message ${targetType === "location" ? "Venue" : "Business"}`}
                      </button>
                      {targetType === "event" && (
                        <button
                          type="button"
                          onClick={() => setView("apply")}
                          className="flex h-11 items-center justify-center rounded-full border border-findmi/40 text-sm font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-findmi-50"
                        >
                          Apply to Participate
                        </button>
                      )}
                      {targetType === "business" && selectedActor?.kind === "event" && (
                        <button
                          type="button"
                          onClick={() => setView("invite")}
                          className="flex h-11 items-center justify-center rounded-full border border-findmi/40 text-sm font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-findmi-50"
                        >
                          Invite to Event
                        </button>
                      )}
                    </div>
                  )}

                  {view === "message" && (
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
                      <button type="button" onClick={() => setView("menu")} className="text-center text-xs font-semibold text-ink/50 transition hover:text-ink">
                        Back
                      </button>
                    </div>
                  )}

                  {view === "apply" && (
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
                        placeholder="Optional note to the organizer…"
                        className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
                      />
                      {error && <p className="text-xs text-red-600">{error}</p>}
                      <button
                        type="button"
                        onClick={submitApply}
                        disabled={submitting}
                        className="flex h-12 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-60"
                      >
                        {submitting ? "…" : "Apply"}
                      </button>
                      <button type="button" onClick={() => setView("menu")} className="text-center text-xs font-semibold text-ink/50 transition hover:text-ink">
                        Back
                      </button>
                    </div>
                  )}

                  {view === "invite" && (
                    <div className="flex flex-col gap-3">
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={3}
                        placeholder={`Optional note to ${targetName}…`}
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
                      <button type="button" onClick={() => setView("menu")} className="text-center text-xs font-semibold text-ink/50 transition hover:text-ink">
                        Back
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

function CloseGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
