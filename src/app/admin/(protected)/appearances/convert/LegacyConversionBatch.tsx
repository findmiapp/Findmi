"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { convertLegacyAppearanceToEvent, type AdminConvertSummary } from "../convert-actions";
import { LEGACY_ELIGIBILITY_LABEL, hasEnded, legacyConversionEligibility, type LegacyConversionRow } from "@/lib/admin/legacy-conversion";

type ItemState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; summary: AdminConvertSummary }
  | { kind: "failed"; message: string };

const REASON: Record<string, string> = {
  already_linked: "Already an Event",
  no_source_link: "No source link",
  source_unavailable: "Source couldn’t be read",
  source_is_calendar: "Link is a calendar, not this Event",
  event_match_exists: "Event already on Findmi",
  source_event_exists: "Event already on Findmi",
  title_mismatch: "Source title doesn’t match",
  date_mismatch: "Source date doesn’t match",
  source_mismatch: "Source link doesn’t match",
  not_found: "Item not found",
  canceled: "Item is canceled",
  no_end: "Item has no end time",
  error: "Couldn’t save — nothing was kept",
};

function when(row: LegacyConversionRow): string {
  return new Date(row.start_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
}

/** Runs the existing conversion ONE item per server request, in order.
 * No automatic retries; Stop finishes the current item and halts. */
export default function LegacyConversionBatch({ businessName, rows }: { businessName: string; rows: LegacyConversionRow[] }) {
  const [now] = useState(() => Date.now());
  const eligible = rows.filter((r) => legacyConversionEligibility(r) === "eligible");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(eligible.filter((r) => !hasEnded(r, now)).map((r) => r.id)));
  const [states, setStates] = useState<Record<string, ItemState>>({});
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);

  const queue = rows.filter((r) => selected.has(r.id));
  const finished = queue.filter((r) => states[r.id]?.kind === "done" || states[r.id]?.kind === "failed");
  const converted = queue.filter((r) => {
    const s = states[r.id];
    return s?.kind === "done" && s.summary.status === "converted";
  }).length;
  const failed = queue.filter((r) => states[r.id]?.kind === "failed").length;
  const skipped = finished.length - converted - failed;

  async function run() {
    stopRef.current = false;
    setRunning(true);
    for (const row of queue) {
      if (stopRef.current) break;
      const prior = states[row.id];
      if (prior?.kind === "done" || prior?.kind === "failed") continue; // never re-sent automatically
      setStates((s) => ({ ...s, [row.id]: { kind: "running" } }));
      try {
        const summary = await convertLegacyAppearanceToEvent(row.id); // one request, one item
        setStates((s) => ({ ...s, [row.id]: { kind: "done", summary } }));
      } catch {
        // The request itself failed (e.g. cut off). The item may still
        // have converted — reload before trying it again.
        setStates((s) => ({ ...s, [row.id]: { kind: "failed", message: "Request didn’t finish — reload to check this item before trying again." } }));
      }
    }
    setRunning(false);
  }

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="mt-5">
      <div className="flex flex-col gap-2 rounded-xl border border-black/10 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink/70">
          <span className="font-semibold text-ink">{businessName}</span> · {queue.length} selected · {converted} converted · {skipped} skipped
          {failed ? ` · ${failed} didn’t finish` : ""} · {queue.length - finished.length} remaining
        </p>
        <div className="flex gap-2">
          {running ? (
            <button type="button" onClick={() => (stopRef.current = true)} className="rounded-lg border border-black/15 px-3 py-1.5 text-sm font-semibold text-ink">
              Stop After This One
            </button>
          ) : (
            <button
              type="button"
              disabled={queue.length === 0 || finished.length === queue.length}
              onClick={run}
              className="rounded-lg bg-findmi px-3 py-1.5 text-sm font-semibold text-white hover:bg-findmi-600 disabled:opacity-40"
            >
              Convert Selected
            </button>
          )}
        </div>
      </div>

      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((row) => {
          const eligibility = legacyConversionEligibility(row);
          const state = states[row.id] ?? { kind: "idle" };
          const ended = hasEnded(row, now);
          const s = state.kind === "done" ? state.summary : null;
          return (
            <li key={row.id} className="rounded-xl border border-black/5 bg-white px-4 py-3">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0"
                  aria-label={`Select ${row.title}`}
                  disabled={eligibility !== "eligible" || running || state.kind !== "idle"}
                  checked={selected.has(row.id)}
                  onChange={() => toggle(row.id)}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">{row.title}</p>
                  <p className="text-xs text-ink/50">
                    {when(row)} · {row.location_name ?? row.venue_name ?? "No place"}
                    {ended ? " · Ended" : ""}
                  </p>
                  <p className="truncate text-[11px] text-ink/40">
                    <Link href={`/admin/appearances/${row.id}`} className="hover:underline">
                      Schedule item
                    </Link>
                    {" · "}
                    {row.external_url}
                  </p>

                  {state.kind === "running" && <p className="mt-1.5 text-xs font-semibold text-findmi-700">Converting…</p>}
                  {state.kind === "failed" && <p className="mt-1.5 text-xs font-semibold text-red-700">{state.message}</p>}
                  {s?.status === "converted" && (
                    <p className="mt-1.5 text-xs text-findmi-700">
                      <span className="font-semibold">Converted{s.persisted.live ? " · Live" : ""}</span>
                      {" · "}
                      {s.persisted.coverUrl ? "Event image stored" : s.image === "failed" ? "Image couldn’t be recovered" : "No Event image"}
                      {" · "}
                      <Link href={`/admin/events/${s.eventId}`} className="font-semibold underline">
                        Event
                      </Link>
                      {s.persisted.slug && s.persisted.live && (
                        <>
                          {" · "}
                          <a href={`/event/${s.persisted.slug}`} target="_blank" rel="noreferrer" className="font-semibold underline">
                            View
                          </a>
                        </>
                      )}
                      {s.warnings.length > 0 && <span className="block text-ink/50">{s.warnings.join(" ")}</span>}
                    </p>
                  )}
                  {s && s.status === "not_converted" && (
                    <p className="mt-1.5 text-xs text-ink/60">
                      <span className="font-semibold text-ink/80">Skipped — {REASON[s.reason] ?? s.reason}</span>
                      {s.detail ? ` · ${s.detail}` : ""}
                      {s.eventId && (
                        <>
                          {" · "}
                          <Link href={`/admin/events/${s.eventId}`} className="underline">
                            Event {s.eventId.slice(0, 8)}
                          </Link>
                        </>
                      )}
                    </p>
                  )}
                </div>
                {eligibility !== "eligible" && (
                  <span className="shrink-0 rounded-full bg-black/[0.06] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-ink/50">
                    {LEGACY_ELIGIBILITY_LABEL[eligibility]}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {rows.length === 0 && <p className="mt-3 text-sm text-ink/50">This Business has no schedule items with their own Event link.</p>}
    </div>
  );
}
