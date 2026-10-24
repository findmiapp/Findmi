"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  BUSINESS_MATCH_ACTION_LABELS,
  BUSINESS_SEARCH_DEBOUNCE_MS,
  isMeaningfulBusinessQuery,
  type BusinessSearchCard,
} from "@/lib/business-name-search-domain";
import { lookupExistingBusinesses } from "./lookup-action";

type LookupState = { status: "idle" } | { status: "loading" } | { status: "done"; results: BusinessSearchCard[]; possiblePrivateMatch: boolean } | { status: "error" };

/** Add Business — Business Name is SEARCH-FIRST. Typing a meaningful name
 * (debounced, bounded, server-throttled) looks up existing public Findmi
 * Businesses and shows likely matches with enough identity to tell them
 * apart (logo, name, category, city/state), each routed into its existing
 * path: Manage, Claim, View (claim pending) or Request Access. Only when
 * none fits does "Can't Find Your Business? Create [typed name]" reveal the
 * rest of the creation form (`children`), which keeps every existing
 * field, authorization confirmation and review rule unchanged. A returning
 * submission (error / duplicate / prefill / resume) opens straight onto the
 * form with its typed values. The input is the form's own `name` field. */
export default function BusinessNameSearchFirst({
  inputClass,
  initialName,
  startCreating,
  children,
}: {
  inputClass: string;
  initialName: string;
  /** Skip the search step (the form was already in progress). */
  startCreating: boolean;
  children: ReactNode;
}) {
  const [name, setName] = useState(initialName);
  const [creating, setCreating] = useState(startCreating);
  const [lookup, setLookup] = useState<LookupState>({ status: "idle" });
  // Only the latest lookup may update the list (typing fast never shows a
  // stale answer).
  const requestRef = useRef(0);
  const formStartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (creating) return;
    const q = name.trim();
    const request = ++requestRef.current;
    if (!isMeaningfulBusinessQuery(q)) {
      setLookup({ status: "idle" });
      return;
    }
    setLookup({ status: "loading" });
    const t = setTimeout(async () => {
      try {
        const res = await lookupExistingBusinesses(q);
        if (request === requestRef.current) setLookup({ status: "done", results: res.results, possiblePrivateMatch: res.possiblePrivateMatch });
      } catch {
        if (request === requestRef.current) setLookup({ status: "error" });
      }
    }, BUSINESS_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [name, creating]);

  const typed = name.trim();
  const startCreate = () => {
    setCreating(true);
    requestAnimationFrame(() => formStartRef.current?.querySelector<HTMLElement>("select, input, textarea")?.focus());
  };

  return (
    <>
      <label className="block">
        <span className="mb-1.5 block text-body font-medium text-primary">Business name</span>
        <input
          autoCapitalize="words"
          type="text"
          name="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            // Enter never submits a half-revealed form during the search step.
            if (e.key === "Enter" && !creating) {
              e.preventDefault();
              if (isMeaningfulBusinessQuery(name)) startCreate();
            }
          }}
          placeholder={creating ? "Your business name" : "Search for your business on Findmi"}
          autoComplete="organization"
          className={inputClass}
        />
      </label>

      {!creating && (
        <div className="-mt-1 flex flex-col gap-2" aria-live="polite">
          {lookup.status === "idle" && <p className="text-metadata text-muted">Start typing — we&rsquo;ll check whether your Business is already on Findmi.</p>}
          {lookup.status === "loading" && <p className="text-metadata text-muted">Searching Findmi…</p>}
          {lookup.status === "error" && <p className="text-metadata text-muted">Couldn&rsquo;t search right now — you can still create it below.</p>}
          {lookup.status === "done" && lookup.results.length > 0 && (
            <>
              <p className="text-label font-bold uppercase text-subtle">Already On Findmi?</p>
              <ul className="flex flex-col gap-2">
                {lookup.results.map((b) => (
                  <li key={b.slug}>
                    <div className="flex items-center gap-3 rounded-2xl border border-black/[0.08] bg-white p-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-mist text-sm font-bold text-ink/50">
                        {b.logoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={b.logoUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          b.name.slice(0, 1).toUpperCase()
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-semibold text-primary">{b.name}</span>
                        <span className="block truncate text-metadata text-muted">{[b.category, b.place].filter(Boolean).join(" · ") || "On Findmi"}</span>
                        <span className="block truncate text-microcopy text-subtle">{BUSINESS_MATCH_ACTION_LABELS[b.action].note}</span>
                      </span>
                      <Link
                        href={b.href}
                        className={`flex h-9 shrink-0 items-center rounded-full px-3.5 text-metadata font-bold transition ${
                          b.action === "claim" || b.action === "manage" ? "bg-findmi text-white hover:bg-findmi-600" : "border border-black/10 text-primary hover:border-black/20"
                        }`}
                      >
                        {BUSINESS_MATCH_ACTION_LABELS[b.action].cta}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          {lookup.status === "done" && lookup.results.length === 0 && (
            <p className="text-metadata text-muted">
              {lookup.possiblePrivateMatch
                ? "A matching Business may already be on Findmi but isn’t public yet. If it’s yours, contact Findmi before creating another."
                : "No matching Business on Findmi yet."}
            </p>
          )}
          {isMeaningfulBusinessQuery(typed) && (lookup.status === "done" || lookup.status === "error") && (
            <div className="mt-1 rounded-2xl border border-dashed border-black/15 p-3">
              <p className="text-body font-semibold text-primary">Can&rsquo;t Find Your Business?</p>
              <button
                type="button"
                onClick={startCreate}
                className="mt-2 flex h-11 w-full items-center justify-center rounded-2xl bg-ink px-4 text-button font-bold text-white transition hover:bg-ink/85"
              >
                <span className="truncate">Create &ldquo;{typed}&rdquo;</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Hidden (not unmounted) until Create, so every field keeps its
          server-rendered default value. */}
      <div ref={formStartRef} className={creating ? "contents" : "hidden"}>
        {children}
      </div>
    </>
  );
}
