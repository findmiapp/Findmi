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

/** The Location's single Hours entry point (Final Hero Hierarchy pass:
 * a full-width compact status bar under the action row). The whole bar
 * is one real button — "OPEN NOW · Until 4 PM" / "CLOSED · Opens 7 AM
 * Tomorrow" with a chevron — that expands the compact week inline
 * directly beneath it and collapses it again. Collapsed, nothing else is
 * shown. Same stored hours and open/closed rule as before — nothing
 * invented. Until the visitor's clock is known it reserves the bar's
 * height (no layout jump for the Featured Event below); without real
 * hours the caller doesn't render it at all. */
export function LocationHoursStatus({ hours }: { hours: LocationHoursValue | null | undefined }) {
  const now = useClientNow();
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const status = now ? getHoursStatus(hours, now) : null;
  if (!now) return <div aria-hidden="true" className="mt-2 h-11 rounded-xl bg-black/[0.03]" />;
  if (!status) return null;
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
        className="flex h-11 w-full items-center gap-3 rounded-xl bg-black/[0.04] px-3.5 text-left transition hover:bg-black/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi"
      >
        <span className={`shrink-0 text-xs font-bold uppercase tracking-wide ${status.open ? "text-findmi-700" : "text-ink/70"}`}>{label}</span>
        <span className="ml-auto min-w-0 truncate text-sm text-ink/60">{status.detail}</span>
        <ChevronIcon direction={expanded ? "up" : "down"} className="h-4 w-4 shrink-0 text-ink/40" />
      </button>

      {expanded && (
        <dl id={panelId} aria-label="Hours" className="mt-1.5 flex flex-col gap-0.5 rounded-xl border border-black/5 bg-white px-3.5 py-2">
          {LOCATION_WEEKDAYS.map(({ key, label: dayLabel }) => {
            const isToday = key === todayKey;
            return (
              <div
                key={key}
                className={`-mx-1.5 flex items-center justify-between rounded-md px-1.5 py-0.5 text-sm ${isToday ? "bg-findmi-50/70 font-semibold text-ink" : "text-ink/75"}`}
              >
                <dt>
                  {dayLabel}
                  {isToday && <span className="text-findmi-700"> · Today</span>}
                </dt>
                <dd className="tabular-nums">{formatDayHoursCompact(hours?.[key])}</dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
}
