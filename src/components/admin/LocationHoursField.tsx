"use client";

import { useState } from "react";
import type { LocationDayHours, LocationHours, LocationWeekday } from "@/lib/types";
import { LOCATION_WEEKDAYS } from "@/lib/locationHours";

/** Location V2 — compact weekly hours editor. Standard 7-day week, each
 * day either "Closed" or a single open/close window (no split shifts,
 * holiday exceptions, or timezone engine — V1 keeps this simple per the
 * task's own instruction). Submits the whole week as one JSON blob via a
 * hidden input; a day missing from the object (or with closed=true) is
 * hidden entirely on the public page, same as an empty `hours` column. */

const DEFAULT_DAY: LocationDayHours = { closed: false, open: "09:00", close: "17:00" };

const timeInputClass =
  "w-full rounded-lg border border-black/10 bg-white px-2.5 py-2 text-sm text-ink focus:border-ink/30 focus:outline-none";

export default function LocationHoursField({
  name,
  defaultValue,
}: {
  name: string;
  defaultValue: LocationHours | null;
}) {
  const [hours, setHours] = useState<LocationHours>(defaultValue ?? {});

  function updateDay(day: LocationWeekday, patch: Partial<LocationDayHours>) {
    setHours((prev) => ({ ...prev, [day]: { ...(prev[day] ?? DEFAULT_DAY), ...patch } }));
  }

  // Days never explicitly touched are simply absent from the payload —
  // same "hidden if no hours entered" rule as the column itself, just per
  // day instead of for the whole section.
  const hasAnyDay = Object.keys(hours).length > 0;
  const payload = hasAnyDay ? JSON.stringify(hours) : "";

  return (
    <div className="flex flex-col gap-2">
      <span className="block text-sm font-medium text-ink">Hours of Operation</span>
      <p className="text-xs text-ink/40">
        Optional. Leave every day untouched to hide the Hours section on the public page.
      </p>
      <div className="flex flex-col divide-y divide-black/5 overflow-hidden rounded-xl border border-black/10">
        {LOCATION_WEEKDAYS.map(({ key, label }) => {
          const day = hours[key];
          const closed = day?.closed ?? true;
          const open = day?.open ?? DEFAULT_DAY.open!;
          const close = day?.close ?? DEFAULT_DAY.close!;
          return (
            <div key={key} className="flex flex-wrap items-center gap-3 bg-white px-3.5 py-2.5">
              <span className="w-24 shrink-0 text-sm font-medium text-ink">{label}</span>
              <label className="flex items-center gap-1.5 text-xs text-ink/60">
                <input
                  type="checkbox"
                  checked={!closed}
                  onChange={(e) => updateDay(key, e.target.checked ? { closed: false, open, close } : { closed: true })}
                />
                Open
              </label>
              {!closed && (
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={open}
                    onChange={(e) => updateDay(key, { open: e.target.value })}
                    className={timeInputClass}
                  />
                  <span className="text-xs text-ink/40">to</span>
                  <input
                    type="time"
                    value={close}
                    onChange={(e) => updateDay(key, { close: e.target.value })}
                    className={timeInputClass}
                  />
                </div>
              )}
              {closed && <span className="text-xs text-ink/40">Closed</span>}
            </div>
          );
        })}
      </div>
      <input type="hidden" name={name} value={payload} />
    </div>
  );
}
