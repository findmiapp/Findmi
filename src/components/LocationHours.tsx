"use client";

import { useEffect, useId, useState } from "react";
import ChevronIcon from "./ChevronIcon";
import { LOCATION_WEEKDAYS, formatDayHoursCompact, getHoursStatus, weekdayKeyFor } from "@/lib/locationHours";
import type { LocationHours as LocationHoursValue } from "@/lib/types";

/** The visitor's own clock, read after mount — never the server's (the
 * page renders on a UTC server). Refreshes each minute so a page left
 * open doesn't go stale across a closing time. */
function useClientNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** Field QA UX Pass 2B — the Location's single Hours entry point: the
 * Open Now / Closed pill ("Closed · Opens 7 AM Tomorrow") is a real
 * button that expands a compact weekly schedule inline, directly beneath
 * it, and collapses it again (pill or Hide). Collapsed, there is no
 * Hours container at all. Same stored hours and open/closed rule as
 * before — nothing invented. Renders nothing until the visitor's clock is
 * known, and nothing at all without real hours. */
export function LocationHoursStatus({ hours }: { hours: LocationHoursValue | null | undefined }) {
  const now = useClientNow();
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const status = now ? getHoursStatus(hours, now) : null;
  if (!now || !status) return null;
  const todayKey = weekdayKeyFor(now);
  const label = status.open ? "Open Now" : "Closed";

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={panelId}
        aria-label={`${label}${status.detail ? ` · ${status.detail}` : ""} — ${expanded ? "Hide" : "Show"} Hours`}
        className={`inline-flex min-h-[32px] items-center gap-1 rounded-full px-3 py-1 text-xs transition ${
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
        <ChevronIcon direction={expanded ? "up" : "down"} className="h-3 w-3 shrink-0 opacity-60" />
      </button>

      {expanded && (
        <div id={panelId} className="mt-2 max-w-sm rounded-xl border border-black/5 bg-white px-3 py-2 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wide text-ink/50">Hours</h2>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="-mr-1.5 flex min-h-[32px] items-center px-1.5 text-xs font-semibold text-findmi-700 transition hover:text-findmi-800"
            >
              Hide
            </button>
          </div>
          <dl className="flex flex-col gap-0.5 pb-0.5">
            {LOCATION_WEEKDAYS.map(({ key, short }) => {
              const isToday = key === todayKey;
              return (
                <div
                  key={key}
                  className={`-mx-1.5 flex items-center justify-between rounded-md px-1.5 py-0.5 text-sm ${isToday ? "bg-findmi-50/70 font-semibold text-ink" : "text-ink/75"}`}
                >
                  <dt>
                    {short}
                    {isToday && <span className="text-findmi-700"> · Today</span>}
                  </dt>
                  <dd className="tabular-nums">{formatDayHoursCompact(hours?.[key])}</dd>
                </div>
              );
            })}
          </dl>
        </div>
      )}
    </div>
  );
}
