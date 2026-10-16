"use client";

import { useState } from "react";
import type { LocationDayHours, LocationHours, LocationWeekday } from "@/lib/types";
import { HOURS_NOT_SET, LOCATION_WEEKDAYS, copyDayHours, dayHoursState, hasAnyHours, looksLikeAllDay, setAllDaysOpen24 } from "@/lib/locationHours";

/** Location V2 — compact weekly hours editor. Standard 7-day week, each
 * day Closed, a single open/close window, or Open 24 Hours (no split
 * shifts, holiday exceptions, or timezone engine). Submits the whole week
 * as one JSON blob via a hidden input; a day missing from the object (or
 * with closed=true) is hidden entirely on the public page, same as an
 * empty `hours` column.
 *
 * Location Hours UX — explicit "Open 24 Hours" per day (no more 12:00 AM
 * – 11:59 PM), an "Open 24/7" shortcut that just sets every day to it
 * (each day stays editable), and "Copy To…" from any day to the selected
 * days only. */

const DEFAULT_DAY: LocationDayHours = { closed: false, open: "09:00", close: "17:00" };

type Mode = "closed" | "hours" | "allDay";
const MODES: { key: Mode; label: string }[] = [
  { key: "closed", label: "Closed" },
  { key: "hours", label: "Hours" },
  { key: "allDay", label: "24 Hours" },
];

const timeInputClass =
  "w-full min-w-0 rounded-lg border border-black/10 bg-white px-2.5 py-2 text-sm text-ink focus:border-ink/30 focus:outline-none";

/** null = this day has no usable hours yet ("Not Set") — never shown as
 * Closed: only an explicit Closed choice is closed. */
function modeOf(day: LocationDayHours | undefined): Mode | null {
  const state = dayHoursState(day);
  return state === "unset" ? null : state;
}

export default function LocationHoursField({
  name,
  defaultValue,
}: {
  name: string;
  defaultValue: LocationHours | null;
}) {
  const [hours, setHours] = useState<LocationHours>(defaultValue ?? {});
  const [copyFrom, setCopyFrom] = useState<LocationWeekday | null>(null);
  const [copyTargets, setCopyTargets] = useState<LocationWeekday[]>([]);

  function setMode(day: LocationWeekday, mode: Mode) {
    setHours((prev) => {
      const current = prev[day];
      const open = current?.open ?? DEFAULT_DAY.open!;
      const close = current?.close ?? DEFAULT_DAY.close!;
      const next: LocationDayHours =
        mode === "closed" ? { closed: true } : mode === "allDay" ? { closed: false, allDay: true, open, close } : { closed: false, open, close };
      return { ...prev, [day]: next };
    });
  }

  function setTime(day: LocationWeekday, patch: Partial<LocationDayHours>) {
    setHours((prev) => ({ ...prev, [day]: { ...(prev[day] ?? DEFAULT_DAY), closed: false, allDay: false, ...patch } }));
  }

  function startCopy(day: LocationWeekday) {
    setCopyFrom((cur) => (cur === day ? null : day));
    setCopyTargets([]);
  }

  function applyCopy() {
    if (!copyFrom || copyTargets.length === 0) return;
    setHours((prev) => copyDayHours(prev, copyFrom, copyTargets));
    setCopyFrom(null);
    setCopyTargets([]);
  }

  const legacyAllDay = LOCATION_WEEKDAYS.filter(({ key }) => looksLikeAllDay(hours[key])).map(({ key }) => key);

  // Days never explicitly touched are simply absent from the payload —
  // same "hidden if no hours entered" rule as the column itself, just per
  // day instead of for the whole section.
  const hasAnyDay = Object.keys(hours).length > 0;
  const payload = hasAnyDay ? JSON.stringify(hours) : "";

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium text-ink">
          Hours of Operation
          {!hasAnyHours(hours) && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{HOURS_NOT_SET}</span>}
        </span>
        <button
          type="button"
          onClick={() => setHours((prev) => setAllDaysOpen24(prev))}
          className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-semibold text-ink/70 transition hover:border-findmi/40 hover:text-findmi-700"
        >
          Open 24/7
        </button>
      </div>
      <p className="text-xs text-ink/40">
        Optional. Leave every day untouched to hide the Hours section on the public page.
      </p>

      {legacyAllDay.length > 0 && (
        <div className="flex flex-col items-start gap-1.5 rounded-xl border border-findmi/20 bg-findmi-50/60 px-3 py-2.5">
          <p className="text-xs text-findmi-700">
            {legacyAllDay.length === 7 ? "Every day is" : `${legacyAllDay.length} ${legacyAllDay.length === 1 ? "day is" : "days are"}`} set to 12:00 AM – 11:59 PM. Open all day?
          </p>
          <button
            type="button"
            onClick={() => setHours((prev) => Object.fromEntries(Object.entries(prev).map(([k, d]) => [k, looksLikeAllDay(d) ? { closed: false, allDay: true } : d])) as LocationHours)}
            className="text-xs font-semibold text-findmi-700 underline-offset-2 hover:underline"
          >
            Switch {legacyAllDay.length === 1 ? "It" : "Them"} to Open 24 Hours
          </button>
        </div>
      )}

      <div className="flex flex-col divide-y divide-black/5 overflow-hidden rounded-xl border border-black/10">
        {LOCATION_WEEKDAYS.map(({ key, label }) => {
          const day = hours[key];
          const mode = modeOf(day);
          const open = day?.open ?? DEFAULT_DAY.open!;
          const close = day?.close ?? DEFAULT_DAY.close!;
          const copying = copyFrom === key;
          return (
            <div key={key} className="flex flex-col gap-2 bg-white px-3 py-2.5" data-day={key}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-ink">
                  {label}
                  {mode === null && <span className="ml-2 text-xs font-normal text-ink/40">Not Set</span>}
                </span>
                <button
                  type="button"
                  onClick={() => startCopy(key)}
                  aria-expanded={copying}
                  className="text-xs font-semibold text-findmi-700 hover:underline"
                >
                  {copying ? "Cancel" : "Copy To…"}
                </button>
              </div>

              <div role="radiogroup" aria-label={`${label} hours`} className="grid grid-cols-3 gap-1 rounded-lg bg-black/[0.04] p-0.5">
                {MODES.map((m) => (
                  <label
                    key={m.key}
                    className={`flex h-8 cursor-pointer items-center justify-center rounded-md text-xs font-semibold transition ${
                      mode === m.key ? "bg-white text-ink shadow-sm" : "text-ink/50 hover:text-ink/80"
                    }`}
                  >
                    <input type="radio" name={`${name}-${key}-mode`} value={m.key} checked={mode === m.key} onChange={() => setMode(key, m.key)} className="sr-only" />
                    {m.label}
                  </label>
                ))}
              </div>

              {mode === "hours" && (
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <input type="time" aria-label={`${label} opens`} value={open} onChange={(e) => setTime(key, { open: e.target.value })} className={timeInputClass} />
                  <span className="text-xs text-ink/40">to</span>
                  <input type="time" aria-label={`${label} closes`} value={close} onChange={(e) => setTime(key, { close: e.target.value })} className={timeInputClass} />
                </div>
              )}

              {copying && (
                <fieldset className="flex flex-col gap-2 rounded-lg border border-black/10 bg-black/[0.015] px-2.5 py-2">
                  <legend className="sr-only">Copy {label}&rsquo;s Hours To</legend>
                  <p className="text-xs font-semibold text-ink/70">Copy {label}&rsquo;s Hours To</p>
                  <div className="flex flex-wrap gap-1.5">
                    {LOCATION_WEEKDAYS.filter((d) => d.key !== key).map((d) => {
                      const checked = copyTargets.includes(d.key);
                      return (
                        <label
                          key={d.key}
                          className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                            checked ? "border-findmi/50 bg-findmi-50 text-findmi-700" : "border-black/10 bg-white text-ink/70"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => setCopyTargets((cur) => (e.target.checked ? [...cur, d.key] : cur.filter((k) => k !== d.key)))}
                            className="h-3.5 w-3.5 accent-findmi"
                          />
                          {d.short}
                        </label>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={applyCopy}
                      disabled={copyTargets.length === 0}
                      className="rounded-lg bg-findmi px-3 py-1.5 text-xs font-bold text-white transition hover:bg-findmi-600 disabled:opacity-50"
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      onClick={() => setCopyTargets(copyTargets.length === 6 ? [] : LOCATION_WEEKDAYS.filter((d) => d.key !== key).map((d) => d.key))}
                      className="text-xs font-semibold text-ink/60 hover:text-ink"
                    >
                      {copyTargets.length === 6 ? "Clear" : "Select All"}
                    </button>
                  </div>
                </fieldset>
              )}
            </div>
          );
        })}
      </div>
      <input type="hidden" name={name} value={payload} />
    </div>
  );
}
