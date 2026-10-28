"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { suggestExistingEvents, type ExistingEventSuggestion } from "@/app/(public)/account/event/actions";
import { EVENT_NAME_MIN_CHARS } from "@/lib/event-matching";

/** Host An Event — the Event name is not a blind text field: as it's typed
 * (debounced, ≥ 3 characters, at most one in-flight request) Findmi shows
 * likely existing Events (lib/event-matching.ts via suggestExistingEvents),
 * so the person can open the existing one instead of creating a copy.
 * Purely advisory — nothing is chosen for them. */
export const EVENT_NAME_DEBOUNCE_MS = 400;

export default function EventNameWithSuggestions({
  defaultValue,
  businessId,
  inputClass,
  labelClass,
}: {
  defaultValue: string;
  businessId: string | null;
  inputClass: string;
  labelClass: string;
}) {
  const [name, setName] = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<ExistingEventSuggestion[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    const q = name.trim();
    const request = ++requestRef.current;
    if (q.length < EVENT_NAME_MIN_CHARS) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const found = await suggestExistingEvents({ name: q, businessId });
        if (request === requestRef.current) setSuggestions(found);
      } catch {
        if (request === requestRef.current) setSuggestions([]);
      }
    }, EVENT_NAME_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [name, businessId]);

  return (
    <div className="flex flex-col gap-2">
      <label className="block">
        <span className={labelClass}>Event name</span>
        <input
          autoCapitalize="words"
          type="text"
          name="name"
          required
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setDismissed(false);
          }}
          placeholder="Your event name"
          autoComplete="off"
          className={inputClass}
        />
      </label>
      {suggestions.length > 0 && !dismissed && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-3" aria-live="polite">
          <p className="text-metadata font-semibold text-amber-900">Is it already on Findmi?</p>
          <ul className="mt-2 flex flex-col gap-2">
            {suggestions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-xl border border-black/[0.06] bg-white p-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-semibold text-primary">{s.name}</span>
                  <span className="block truncate text-metadata text-muted">{[s.date, s.city, s.reasons.join(" · ")].filter(Boolean).join(" · ")}</span>
                </span>
                {s.manageHref ? (
                  <Link href={s.manageHref} className="flex h-9 shrink-0 items-center rounded-full bg-findmi px-3.5 text-metadata font-bold text-white hover:bg-findmi-600">
                    Manage It
                  </Link>
                ) : s.publicHref ? (
                  <Link href={s.publicHref} target="_blank" className="flex h-9 shrink-0 items-center rounded-full border border-black/10 px-3.5 text-metadata font-bold text-primary hover:border-black/20">
                    View
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setDismissed(true)} className="mt-2 text-metadata font-semibold text-muted hover:text-primary">
            It&rsquo;s a different Event — keep creating
          </button>
        </div>
      )}
    </div>
  );
}
