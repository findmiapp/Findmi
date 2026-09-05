"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getAccountSession } from "@/lib/accountSession";
import { requestMissingArea } from "@/app/(public)/actions/area-requests";

export interface AreaOption {
  slug: string;
  label: string;
  areasIncluded?: string[] | null;
}

/** Consumer Area Picker V1 — replaces the plain <select>/SortSelect
 * Market dropdown on the homepage/businesses/events with a searchable
 * picker suitable for dozens/hundreds of Areas. URL-driven exactly like
 * SortSelect (?market=<slug>, "All Areas" removes the param, every other
 * current query param is preserved) — this component only changes HOW
 * an Area is chosen, never the URL contract other code already depends
 * on. Search is plain client-side substring matching over the already-
 * fetched (small/consumer-visible) Market list — no server round trip,
 * no geocoding (see lib/market-requests.ts's own note).
 *
 * One shell, two presentations (bottom sheet on mobile, anchored panel
 * from sm: up) — same idea as FilterSheet, kept as its own small
 * component here since the trigger (a live "Area: X" label, not a
 * generic Filters badge) is different enough not to share it outright. */
export default function AreaPicker({
  options,
  paramName = "market",
}: {
  options: AreaOption[];
  paramName?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get(paramName) ?? "";
  const currentLabel = options.find((o) => o.slug === current)?.label ?? "All Areas";

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  function closeAndReset() {
    setOpen(false);
    setQuery("");
  }

  function selectArea(slug: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (!slug) params.delete(paramName);
    else params.set(paramName, slug);
    router.push(`?${params.toString()}`, { scroll: false });
    closeAndReset();
  }

  const normalizedQuery = normalize(query);
  const filtered = normalizedQuery
    ? options.filter((o) => {
        const haystack = [o.label, o.slug, ...(o.areasIncluded ?? [])].map(normalize).join(" ");
        return haystack.includes(normalizedQuery);
      })
    : options;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        className="flex h-10 items-center gap-1.5 rounded-full border border-black/10 px-3.5 text-sm text-ink/70 transition hover:border-black/20"
      >
        <span className="text-ink/40">Area:</span>
        <span className="font-semibold text-ink">{currentLabel}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Choose your Area">
          <div className="absolute inset-0 bg-black/40" onClick={closeAndReset} />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col overflow-hidden rounded-t-3xl bg-white shadow-xl sm:inset-x-auto sm:left-1/2 sm:top-20 sm:bottom-auto sm:w-96 sm:-translate-x-1/2 sm:rounded-3xl">
            <div className="flex items-center justify-between border-b border-black/5 p-4">
              <h2 className="font-display text-lg font-bold tracking-tight text-ink">Find your area</h2>
              <button
                type="button"
                onClick={closeAndReset}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink/60 transition hover:bg-black/5"
              >
                <CloseGlyph className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 pb-2">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search city or area"
                className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/40 focus:border-ink/30 focus:outline-none"
              />
            </div>

            <div className="flex-1 overflow-y-auto p-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={() => selectArea("")}
                className={`mb-1 flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
                  current === "" ? "bg-findmi-50 text-findmi-700" : "text-ink hover:bg-black/[0.03]"
                }`}
              >
                All Areas
              </button>

              {filtered.length > 0 ? (
                <>
                  <p className="mb-1 mt-2 px-3 text-[11px] font-bold uppercase tracking-wide text-ink/40">
                    Available Areas
                  </p>
                  {filtered.map((o) => (
                    <button
                      key={o.slug}
                      type="button"
                      onClick={() => selectArea(o.slug)}
                      className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
                        current === o.slug ? "bg-findmi-50 text-findmi-700" : "text-ink hover:bg-black/[0.03]"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </>
              ) : (
                <RequestAreaPanel query={query} onSubmitted={closeAndReset} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function normalize(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, " ").trim();
}

/** "Don't see your area?" — signed-in visitors get a one-click Notify
 * (their real identity is re-derived server-side in requestMissingArea,
 * never trusted from the client); signed-out visitors are asked for an
 * email, validated server-side. Neither path forces account creation. */
function RequestAreaPanel({ query, onSubmitted }: { query: string; onSubmitted: () => void }) {
  const [checkingSession, setCheckingSession] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAccountSession().then((authenticated) => {
      if (!cancelled) {
        setSignedIn(authenticated);
        setCheckingSession(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit() {
    setState("submitting");
    setError(null);
    const result = await requestMissingArea({ text: query, email });
    if (result.ok) {
      setState("done");
    } else {
      setState("error");
      setError(result.error ?? "Couldn't submit your request.");
    }
  }

  if (state === "done") {
    return (
      <div className="rounded-2xl border border-findmi/20 bg-findmi-50 p-4 text-center">
        <p className="text-sm font-semibold text-findmi-700">You&rsquo;re on the list!</p>
        <p className="mt-1 text-xs text-findmi-700/80">We&rsquo;ll notify you when FindMi launches there.</p>
        <button
          type="button"
          onClick={onSubmitted}
          className="mt-3 text-xs font-bold uppercase tracking-wide text-findmi-700 underline underline-offset-2"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-black/10 bg-mist/30 p-4 text-center">
      <p className="text-sm font-semibold text-ink">
        {query ? <>&ldquo;{query}&rdquo; isn&rsquo;t on FindMi yet.</> : "Don't see your area?"}
      </p>
      <p className="mt-1 text-xs text-ink/55">Notify me when FindMi launches here.</p>

      {!checkingSession && !signedIn && (
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          className="mt-3 w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
        />
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <button
        type="button"
        disabled={!query || query.trim().length < 2 || state === "submitting" || checkingSession}
        onClick={submit}
        className="mt-3 flex h-11 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-50"
      >
        {state === "submitting" ? "Submitting…" : "Notify me"}
      </button>
    </div>
  );
}

function CloseGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
