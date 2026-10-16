"use client";

import { useEffect, useRef, useState } from "react";
import TimeSelect from "./TimeSelect";
import { joinLocalDateTime, nextEndForStart, splitLocalDateTime } from "@/lib/schedule-time";

type Part = { date: string; time: string };

/**
 * Field QA UX Pass 1 — the shared Start / End date-time pair for Event
 * scheduling. Submits exactly what the native datetime-local inputs it
 * replaces did: one "YYYY-MM-DDTHH:MM" value per name (hidden inputs), so
 * every existing Server Action keeps parsing it unchanged.
 *
 *   - time picking favors 15-minute steps (TimeSelect) without ever
 *     rounding an existing or deliberately exact time;
 *   - End follows Start (lib/schedule-time nextEndForStart): it starts
 *     from Start's date — never "today" — keeps the duration when Start
 *     moves, and is only left alone once deliberately set and still valid;
 *   - loading an existing Start/End changes nothing until someone edits;
 *   - End at or before Start blocks submission with a clear message.
 *
 * Event date/time precision — `optionalTimes`: the DATE is required data
 * and times are optional precision on it. A blank Start time submits no
 * start (the date still posts under `dateName`), a blank End time submits
 * no end (an End date alone posts under `endDateName`), and End is never
 * auto-filled from Start — an unknown end stays unknown. An End time with
 * no Start time blocks submission (a start is never guessed).
 */
export default function DateTimeRangeFields({
  startName,
  endName,
  defaultStart,
  defaultEnd,
  startLabel = "Start",
  endLabel = "End",
  required,
  inputClassName,
  labelClassName = "mb-1.5 block text-sm font-medium text-ink",
  onChange,
  optionalTimes = false,
  dateName,
  endDateName,
  defaultDate,
  defaultEndDate,
}: {
  startName: string;
  endName: string;
  defaultStart?: string | null;
  defaultEnd?: string | null;
  startLabel?: string;
  endLabel?: string;
  required?: boolean;
  inputClassName: string;
  labelClassName?: string;
  /** Optional mirror for parents that keep their own copy (e.g. a row editor). */
  onChange?: (value: { start: string; end: string; date: string; endDate: string }) => void;
  /** Times are optional (see above). */
  optionalTimes?: boolean;
  /** Posts the Start DATE alone (always, when set) — the calendar date. */
  dateName?: string;
  /** Posts the End DATE alone (when set) — the calendar end date. */
  endDateName?: string;
  /** The saved calendar date when there is no saved start time. */
  defaultDate?: string | null;
  /** The saved calendar end date when there is no saved end time. */
  defaultEndDate?: string | null;
}) {
  const [start, setStart] = useState<Part>(() => {
    const p = splitLocalDateTime(defaultStart);
    return p.date ? p : { date: defaultDate ?? "", time: "" };
  });
  const [end, setEnd] = useState<Part>(() => {
    const p = splitLocalDateTime(defaultEnd);
    return p.date ? p : { date: defaultEndDate ?? "", time: "" };
  });
  // An End that already exists (editing) counts as deliberately chosen.
  const [endTouched, setEndTouched] = useState(Boolean(defaultEnd));
  const endDateRef = useRef<HTMLInputElement>(null);

  // With optional times, an End time picked without an End date is on the
  // Start's date (a same-day end), never "today".
  const endDateOf = (s: Part, e: Part) => e.date || (optionalTimes && e.time ? s.date : "");
  const startLocal = joinLocalDateTime(start.date, start.time);
  const endLocal = joinLocalDateTime(endDateOf(start, end), end.time);
  const endWithoutStart = optionalTimes && Boolean(end.time) && !start.time;
  const invalid = Boolean(startLocal && endLocal && endLocal <= startLocal) || endWithoutStart;
  const message = endWithoutStart ? "Add a Start time before an End time (or clear the End time)." : "End must be after Start.";

  useEffect(() => {
    endDateRef.current?.setCustomValidity(invalid ? message : "");
  }, [invalid, message]);

  function emit(nextStart: Part, nextEnd: Part) {
    onChange?.({
      start: joinLocalDateTime(nextStart.date, nextStart.time),
      end: joinLocalDateTime(endDateOf(nextStart, nextEnd), nextEnd.time),
      date: nextStart.date,
      endDate: nextEnd.date,
    });
  }

  function changeStart(patch: Partial<Part>) {
    const nextStart = { ...start, ...patch };
    // Optional times: a blank End stays blank (never derived from Start);
    // only its date follows a Start date that moves past it.
    const nextEnd = optionalTimes && !end.time
      ? { date: end.date && nextStart.date && end.date < nextStart.date ? nextStart.date : end.date, time: "" }
      : nextEndForStart({ prevStart: start, nextStart, end, endTouched });
    setStart(nextStart);
    setEnd(nextEnd);
    emit(nextStart, nextEnd);
  }

  function changeEnd(patch: Partial<Part>) {
    const nextEnd = { ...end, ...patch };
    setEnd(nextEnd);
    setEndTouched(true);
    emit(start, nextEnd);
  }

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name={startName} value={startLocal} />
      <input type="hidden" name={endName} value={optionalTimes && !startLocal ? "" : endLocal} />
      {dateName && <input type="hidden" name={dateName} value={start.date} />}
      {endDateName && <input type="hidden" name={endDateName} value={end.date} />}
      <fieldset className="min-w-0">
        <legend className={labelClassName}>{startLabel}</legend>
        <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-2">
          <input
            type="date"
            value={start.date}
            required={required}
            aria-label={`${startLabel} date`}
            onChange={(e) => changeStart({ date: e.target.value })}
            className={inputClassName}
          />
          <TimeSelect
            value={start.time}
            onChange={(time) => changeStart({ time })}
            required={required && !optionalTimes}
            placeholder={optionalTimes ? "Time Not Listed" : undefined}
            ariaLabel={`${startLabel} time`}
            className={inputClassName}
          />
        </div>
      </fieldset>
      <fieldset className="min-w-0">
        <legend className={labelClassName}>{endLabel}</legend>
        <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-2">
          <input
            ref={endDateRef}
            type="date"
            value={end.date}
            min={start.date || undefined}
            required={required && !optionalTimes}
            aria-label={`${endLabel} date`}
            aria-invalid={invalid}
            onChange={(e) => changeEnd({ date: e.target.value })}
            className={inputClassName}
          />
          <TimeSelect
            value={end.time}
            onChange={(time) => changeEnd({ time })}
            required={required && !optionalTimes}
            placeholder={optionalTimes ? "Not Listed" : undefined}
            ariaLabel={`${endLabel} time`}
            className={inputClassName}
          />
        </div>
      </fieldset>
      {invalid && <p className="text-xs text-red-600">{message}</p>}
      {optionalTimes && start.date && !start.time && !end.time && <p className="text-xs text-ink/50">Time Not Listed — the date is saved with no time.</p>}
      {optionalTimes && start.time && !end.time && <p className="text-xs text-ink/50">No end time — Findmi won&rsquo;t show a closing time.</p>}
    </div>
  );
}
