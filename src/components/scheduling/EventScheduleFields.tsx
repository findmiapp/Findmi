"use client";

import { useMemo, useState, type ReactNode } from "react";
import { CREATE_SCHEDULE_MODES, parseScheduleDates, resolveCreateSchedule, type CreateScheduleMode, type ScheduleDate } from "@/lib/event-create-schedule";
import { enumerateCalendarDates } from "@/lib/schedule-dates";

/** Event creation — dates up front, compact. A three-way control (Single
 * Date · Date Range · Multiple Dates) over ONE date model
 * (lib/event-create-schedule): Single Date renders the existing start /
 * end pair (`single`, passed in so it stays the established
 * DateTimeRangeFields); the other two post `schedule_mode` plus their own
 * fields, which the server resolves to the Primary Date and extra
 * occurrences through Event Manager's existing date generator. Only the
 * chosen mode's fields render, so the screen never shows every scheduling
 * field at once. */
export default function EventScheduleFields({
  single,
  inputClassName,
  labelClassName,
  defaults,
}: {
  single: ReactNode;
  inputClassName: string;
  labelClassName: string;
  defaults?: { mode?: string | null; rangeStart?: string | null; rangeEnd?: string | null; dailyStart?: string | null; dailyEnd?: string | null; multiDates?: string | null };
}) {
  const initialMode: CreateScheduleMode = defaults?.mode === "range" || defaults?.mode === "multiple" ? defaults.mode : "single";
  const [mode, setMode] = useState<CreateScheduleMode>(initialMode);
  const [rangeStart, setRangeStart] = useState(defaults?.rangeStart ?? "");
  const [rangeEnd, setRangeEnd] = useState(defaults?.rangeEnd ?? "");
  const [dailyStart, setDailyStart] = useState(defaults?.dailyStart ?? "10:00");
  const [dailyEnd, setDailyEnd] = useState(defaults?.dailyEnd ?? "17:00");
  const initialDates = parseScheduleDates(defaults?.multiDates);
  const [dates, setDates] = useState<ScheduleDate[]>(
    initialDates.length > 0
      ? initialDates
      : [
          { date: "", start_time: "10:00", end_time: "17:00" },
          { date: "", start_time: "10:00", end_time: "17:00" },
        ]
  );

  const rangeDays = useMemo(() => (rangeStart && rangeEnd ? enumerateCalendarDates(rangeStart, rangeEnd).length : 0), [rangeStart, rangeEnd]);
  const multiCheck = useMemo(() => (mode === "multiple" ? resolveCreateSchedule("multiple", { dates: dates.filter((d) => d.date) }) : null), [mode, dates]);

  const setDate = (i: number, patch: Partial<ScheduleDate>) => setDates((prev) => prev.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className={labelClassName}>Dates</legend>
      <div role="radiogroup" aria-label="How is this Event scheduled?" className="grid grid-cols-3 gap-1 rounded-full bg-black/[0.05] p-1">
        {CREATE_SCHEDULE_MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            role="radio"
            aria-checked={mode === m.key}
            onClick={() => setMode(m.key)}
            className={`h-8 min-w-0 truncate rounded-full px-2 text-[12px] font-semibold transition sm:text-[13px] ${mode === m.key ? "bg-white text-primary shadow-sm" : "text-muted hover:text-primary"}`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="-mt-1 text-metadata text-muted">{CREATE_SCHEDULE_MODES.find((m) => m.key === mode)?.hint}</p>

      {mode === "single" && single}

      {mode === "range" && (
        <div className="grid grid-cols-2 gap-3">
          <input type="hidden" name="schedule_mode" value="range" />
          <label className="block min-w-0">
            <span className={labelClassName}>First day</span>
            <input type="date" name="range_start" required value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} className={inputClassName} />
          </label>
          <label className="block min-w-0">
            <span className={labelClassName}>Last day</span>
            <input type="date" name="range_end" required min={rangeStart || undefined} value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} className={inputClassName} />
          </label>
          <label className="block min-w-0">
            <span className={labelClassName}>Opens</span>
            <input type="time" name="daily_start" required step={900} value={dailyStart} onChange={(e) => setDailyStart(e.target.value)} className={inputClassName} />
          </label>
          <label className="block min-w-0">
            <span className={labelClassName}>Closes</span>
            <input type="time" name="daily_end" required step={900} value={dailyEnd} onChange={(e) => setDailyEnd(e.target.value)} className={inputClassName} />
          </label>
          <p className="col-span-2 text-metadata text-muted" aria-live="polite">
            {rangeDays > 1 ? `Creates ${rangeDays} dates, one per day.` : "Choose a first and last day."}
          </p>
        </div>
      )}

      {mode === "multiple" && (
        <div className="flex flex-col gap-2">
          <input type="hidden" name="schedule_mode" value="multiple" />
          <input type="hidden" name="multi_dates" value={JSON.stringify(dates.filter((d) => d.date))} />
          {dates.map((d, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-1.5">
              <label className="block min-w-0">
                <span className="mb-1 block text-[11px] font-medium text-muted">Date {i + 1}</span>
                <input type="date" aria-label={`Date ${i + 1}`} value={d.date} onChange={(e) => setDate(i, { date: e.target.value })} className={inputClassName} />
              </label>
              <label className="block min-w-0">
                <span className="mb-1 block text-[11px] font-medium text-muted">Starts</span>
                <input type="time" step={900} aria-label={`Date ${i + 1} start`} value={d.start_time} onChange={(e) => setDate(i, { start_time: e.target.value })} className={inputClassName} />
              </label>
              <label className="block min-w-0">
                <span className="mb-1 block text-[11px] font-medium text-muted">Ends</span>
                <input type="time" step={900} aria-label={`Date ${i + 1} end`} value={d.end_time} onChange={(e) => setDate(i, { end_time: e.target.value })} className={inputClassName} />
              </label>
              <button
                type="button"
                aria-label={`Remove date ${i + 1}`}
                disabled={dates.length <= 2}
                onClick={() => setDates((prev) => prev.filter((_, j) => j !== i))}
                className="mb-1 flex h-9 w-8 items-center justify-center rounded-full text-ink/40 hover:text-ink disabled:opacity-30"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setDates((prev) => [...prev, { date: "", start_time: prev[prev.length - 1]?.start_time ?? "10:00", end_time: prev[prev.length - 1]?.end_time ?? "17:00" }])}
            className="w-fit text-metadata font-semibold text-accent hover:underline"
          >
            + Add Another Date
          </button>
          <p className="text-metadata text-muted" aria-live="polite">
            {multiCheck && !multiCheck.ok ? multiCheck.error : "One per day — add a second session on the same day later in Event Manager."}
          </p>
        </div>
      )}
    </fieldset>
  );
}
