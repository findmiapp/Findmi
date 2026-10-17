"use client";

import { useEffect, useState, useTransition } from "react";
import NavIcon from "@/components/NavIcon";
import type { NavIconKey } from "@/lib/navigation";
import type { BusinessIdea } from "@/lib/brand-audit";
import { IDEA_LIMITS, IDEA_RESPONSES, IDEA_RESPONSE_LABELS, IDEA_TYPE_LABELS, type IdeaResponse, type IdeaType } from "@/lib/brand-audit-domain";
import type { ActionResult } from "../brand-audit/actions";

const TYPE_ICON: Record<IdeaType, NavIconKey> = {
  sampling: "tag",
  residential: "home",
  workplace: "storefront",
  retail: "cart",
  events: "calendar",
  hospitality: "storefront",
  wellness: "target",
  campus: "person",
  partnerships: "person",
  content: "compass",
  sponsorship: "target",
  other: "compass",
};

/** Same edge-to-edge snap rail as BusinessHome's other rails. */
const RAIL_CLASS =
  "-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:scroll-px-0 lg:px-0 [&::-webkit-scrollbar]:hidden";

/** Ideas For Your Brand — Findmi-authored Opportunity Ideas (strategies and
 * channels, not available inventory) as a swipeable card rail. Opening a
 * card asks "Could This Be Relevant To Your Brand?" (Interested / Maybe /
 * Not For Us) with an optional Tell Us More note. The server only ever
 * sends Ideas this Business is eligible for, unanswered first; an answered
 * card shows its response and can be changed, but never reads as waiting. */
export default function IdeasForYourBrand({
  ideas: initialIdeas,
  canRespond,
  respond,
}: {
  ideas: BusinessIdea[];
  canRespond: boolean;
  respond: (ideaId: string, response: string, note?: string | null) => Promise<ActionResult>;
}) {
  const [ideas, setIdeas] = useState(initialIdeas);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = ideas.find((i) => i.id === openId) ?? null;
  const unanswered = ideas.filter((i) => !i.response).length;

  if (ideas.length === 0) return null;

  const update = (id: string, response: { value: IdeaResponse; note: string | null }) =>
    setIdeas((prev) => prev.map((i) => (i.id === id ? { ...i, response: { ...response, updatedAt: new Date().toISOString() } } : i)));

  return (
    <section id="home-ideas" aria-labelledby="ideas-for-your-brand" className="scroll-mt-[104px]">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="ideas-for-your-brand" className="font-display text-section-title font-bold text-primary">
          Ideas For Your Brand
        </h2>
        {unanswered > 0 && unanswered < ideas.length && <span className="text-metadata font-semibold text-muted">{unanswered} New</span>}
      </div>
      <p className="mt-0.5 text-metadata text-muted">Explore ways Findmi could help you reach your goals.</p>
      <ul className={`mt-3 ${RAIL_CLASS}`}>
        {ideas.map((idea) => (
          <li key={idea.id} className="w-[min(15.5rem,72vw)] shrink-0 snap-start">
            <button
              type="button"
              onClick={() => setOpenId(idea.id)}
              className="flex h-full w-full flex-col rounded-3xl border border-black/[0.07] bg-white p-3.5 text-left shadow-sm transition hover:border-findmi/40 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
            >
              <span className="flex items-start justify-between gap-2">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-findmi-50 text-findmi-700">
                  <NavIcon name={TYPE_ICON[idea.ideaType] ?? "compass"} className="h-6 w-6" />
                </span>
                {idea.response ? (
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${idea.response.value === "not_for_us" ? "bg-black/5 text-ink/50" : "bg-findmi-50 text-findmi-700"}`}>
                    {IDEA_RESPONSE_LABELS[idea.response.value]}
                  </span>
                ) : (
                  <span className="text-label font-bold uppercase text-subtle">{IDEA_TYPE_LABELS[idea.ideaType]}</span>
                )}
              </span>
              <span className="mt-3 block font-display text-card-title-lg font-semibold leading-snug text-primary">{idea.title}</span>
              <span className="mt-1 line-clamp-3 block flex-1 text-metadata text-muted">{idea.summary}</span>
              <span className="mt-3 text-metadata font-bold text-accent">{idea.response ? "Update Response" : "Could This Fit?"}</span>
            </button>
          </li>
        ))}
        <li aria-hidden="true" className="w-1 shrink-0" />
      </ul>
      {open && <IdeaSheet idea={open} canRespond={canRespond} respond={respond} onSaved={update} onClose={() => setOpenId(null)} />}
    </section>
  );
}

function IdeaSheet({
  idea,
  canRespond,
  respond,
  onSaved,
  onClose,
}: {
  idea: BusinessIdea;
  canRespond: boolean;
  respond: (ideaId: string, response: string, note?: string | null) => Promise<ActionResult>;
  onSaved: (id: string, response: { value: IdeaResponse; note: string | null }) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState(idea.response?.note ?? "");
  const [noteOpen, setNoteOpen] = useState(Boolean(idea.response?.note));
  const [noteSaved, setNoteSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const choose = (value: IdeaResponse) =>
    startTransition(async () => {
      setError(null);
      const result = await respond(idea.id, value);
      if (!result.ok) return setError(result.error);
      onSaved(idea.id, { value, note: idea.response?.note ?? null });
    });

  const saveNote = () =>
    startTransition(async () => {
      if (!idea.response) return;
      setError(null);
      const result = await respond(idea.id, idea.response.value, note);
      if (!result.ok) return setError(result.error);
      onSaved(idea.id, { value: idea.response.value, note: note.trim() || null });
      setNoteSaved(true);
    });

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={idea.title}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative max-h-[88vh] w-full overflow-y-auto rounded-t-3xl bg-white px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 shadow-xl sm:max-w-md sm:rounded-3xl sm:pt-5">
        <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-full bg-black/10 sm:hidden" />
        <div className="flex items-start gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-findmi-50 text-findmi-700">
            <NavIcon name={TYPE_ICON[idea.ideaType] ?? "compass"} className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-label font-bold uppercase text-subtle">{IDEA_TYPE_LABELS[idea.ideaType]}</p>
            <h3 className="mt-0.5 font-display text-section-title font-bold leading-tight text-primary">{idea.title}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink/40 hover:bg-black/5 hover:text-ink">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4" aria-hidden="true">
              <path d="M5 5l10 10M15 5 5 15" />
            </svg>
          </button>
        </div>
        <p className="mt-3 text-body text-secondary">{idea.summary}</p>
        {idea.details && <p className="mt-2 whitespace-pre-line text-body text-muted">{idea.details}</p>}

        <div className="mt-5 border-t border-black/[0.06] pt-4">
          <p className="text-card-title font-bold text-primary">Could This Be Relevant To Your Brand?</p>
          <div role="radiogroup" aria-label="Could This Be Relevant To Your Brand?" className="mt-2.5 grid grid-cols-3 gap-2">
            {IDEA_RESPONSES.map((value) => {
              const selected = idea.response?.value === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={!canRespond || pending}
                  onClick={() => choose(value)}
                  className={`flex h-12 items-center justify-center rounded-2xl border px-2 text-button font-bold transition disabled:cursor-default ${
                    selected ? "border-findmi bg-findmi text-white" : "border-black/10 bg-white text-primary hover:border-findmi/40"
                  } ${!canRespond && !selected ? "opacity-50" : ""}`}
                >
                  {IDEA_RESPONSE_LABELS[value]}
                </button>
              );
            })}
          </div>
          {!canRespond && <p className="mt-2 text-metadata text-muted">Only a Business owner or manager can respond.</p>}

          {canRespond && idea.response && (
            <div className="mt-3">
              {!noteOpen ? (
                <button type="button" onClick={() => setNoteOpen(true)} className="text-metadata font-semibold text-accent hover:underline">
                  Tell Us More (Optional)
                </button>
              ) : (
                <div>
                  <label htmlFor={`idea-note-${idea.id}`} className="text-metadata font-semibold text-secondary">
                    Tell Us More (Optional)
                  </label>
                  <textarea
                    id={`idea-note-${idea.id}`}
                    autoCapitalize="sentences"
                    rows={3}
                    maxLength={IDEA_LIMITS.note}
                    value={note}
                    onChange={(e) => {
                      setNote(e.target.value);
                      setNoteSaved(false);
                    }}
                    placeholder="Where, when or how this could work for your brand."
                    className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-body text-primary placeholder:text-subtle focus:border-findmi/50 focus:outline-none focus:ring-2 focus:ring-findmi/20"
                  />
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      type="button"
                      disabled={pending || note.trim() === (idea.response.note ?? "")}
                      onClick={saveNote}
                      className="flex h-10 items-center rounded-xl bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600 disabled:opacity-40"
                    >
                      Save Note
                    </button>
                    {noteSaved && <span className="text-metadata font-semibold text-findmi-700">Saved</span>}
                  </div>
                </div>
              )}
            </div>
          )}
          {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-metadata font-semibold text-red-700">{error}</p>}
        </div>
      </div>
    </div>
  );
}
