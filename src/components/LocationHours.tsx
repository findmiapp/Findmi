"use client";

import { useEffect, useRef, useState } from "react";
import ChevronIcon from "./ChevronIcon";
import { LOCATION_WEEKDAYS, formatDayHours, getHoursStatus, weekdayKeyFor } from "@/lib/locationHours";
import type { LocationHours as LocationHoursValue } from "@/lib/types";

/** Field QA UX Pass 2 — the pill tells the Hours card to open + scroll. */
const SHOW_HOURS_EVENT = "findmi:show-hours";
const HOURS_ANCHOR_ID = "hours";

/** The visitor's own clock, read after mount — never the server's (the
 * page renders on a UTC server, which made the old server-computed
 * Open/Closed badge wrong for most of the day). Refreshes each minute so
 * a page left open doesn't go stale across a closing time. */
function useClientNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** Open Now / Closed — a real button that reveals the Hours card below
 * (expands it and scrolls it into view). Only rendered when real hours
 * exist; renders nothing until the visitor's clock is known. */
export function LocationHoursStatusPill({ hours }: { hours: LocationHoursValue | null | undefined }) {
  const now = useClientNow();
  const status = now ? getHoursStatus(hours, now) : null;
  if (!status) return null;
  const label = status.open ? "Open Now" : "Closed";
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(SHOW_HOURS_EVENT))}
      aria-controls={HOURS_ANCHOR_ID}
      aria-label={`${label}${status.detail ? ` · ${status.detail}` : ""} — View Hours`}
      className={`inline-flex min-h-[28px] items-center gap-1 rounded-full px-2.5 py-1 text-xs transition ${
        status.open ? "bg-findmi-50 text-findmi-700 hover:bg-findmi-100" : "bg-black/[0.04] text-ink/60 hover:bg-black/[0.07]"
      }`}
    >
      <span className="font-bold uppercase tracking-wide">{label}</span>
      {status.detail && (
        <>
          <span aria-hidden="true">·</span>
          <span className="font-medium">{status.detail}</span>
        </>
      )}
      <ChevronIcon direction="down" className="h-3 w-3 shrink-0 opacity-60" />
    </button>
  );
}

/** Compact Hours card: "Hours / Today 7:00 AM - 4:00 PM / View All Hours".
 * Collapsed by default to the one row most visitors need; the toggle
 * expands the full week in place (today highlighted). Same stored hours
 * and the same formatDayHours presentation as before — nothing invented. */
export function LocationHoursCard({ hours }: { hours: LocationHoursValue | null | undefined }) {
  const now = useClientNow();
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const todayKey = now ? weekdayKeyFor(now) : null;

  useEffect(() => {
    function reveal() {
      setExpanded(true);
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    window.addEventListener(SHOW_HOURS_EVENT, reveal);
    return () => window.removeEventListener(SHOW_HOURS_EVENT, reveal);
  }, []);

  return (
    <section ref={ref} id={HOURS_ANCHOR_ID} aria-labelledby="hours-heading" className="scroll-mt-20 rounded-2xl border border-black/5 bg-white px-4 py-3 shadow-sm sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="hours-heading" className="font-display text-base font-bold tracking-tight text-ink">
          Hours
        </h2>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="hours-week"
          className="-mr-2 flex min-h-[40px] items-center gap-1 px-2 text-sm font-semibold text-findmi-700 transition hover:text-findmi-800"
        >
          {expanded ? "Hide Hours" : "View All Hours"}
          <ChevronIcon direction={expanded ? "up" : "right"} className="h-4 w-4 shrink-0" />
        </button>
      </div>
      {!expanded && (
        <p className="flex min-h-[20px] items-center justify-between text-sm">
          {todayKey && (
            <>
              <span className="text-ink/60">Today</span>
              <span className="font-medium text-ink">{formatDayHours(hours?.[todayKey])}</span>
            </>
          )}
        </p>
      )}
      {expanded && (
        <dl id="hours-week" className="mt-1 flex flex-col gap-1 pb-1">
          {LOCATION_WEEKDAYS.map(({ key, label }) => {
            const isToday = key === todayKey;
            return (
              <div key={key} className={`flex items-center justify-between text-sm ${isToday ? "font-semibold" : ""}`}>
                <dt className={isToday ? "text-ink" : "text-ink/60"}>
                  {label}
                  {isToday && <span className="ml-1.5 text-xs font-bold uppercase tracking-wide text-findmi-700">Today</span>}
                </dt>
                <dd className={isToday ? "text-ink" : "font-medium text-ink"}>{formatDayHours(hours?.[key])}</dd>
              </div>
            );
          })}
        </dl>
      )}
    </section>
  );
}
