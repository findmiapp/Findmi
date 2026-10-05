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
  onChange?: (value: { start: string; end: string }) => void;
}) {
  const [start, setStart] = useState<Part>(() => splitLocalDateTime(defaultStart));
  const [end, setEnd] = useState<Part>(() => splitLocalDateTime(defaultEnd));
  // An End that already exists (editing) counts as deliberately chosen.
  const [endTouched, setEndTouched] = useState(Boolean(defaultEnd));
  const endDateRef = useRef<HTMLInputElement>(null);

  const startLocal = joinLocalDateTime(start.date, start.time);
  const endLocal = joinLocalDateTime(end.date, end.time);
  const invalid = Boolean(startLocal && endLocal && endLocal <= startLocal);

  useEffect(() => {
    endDateRef.current?.setCustomValidity(invalid ? "End must be after Start." : "");
  }, [invalid]);

  function emit(nextStart: Part, nextEnd: Part) {
    onChange?.({ start: joinLocalDateTime(nextStart.date, nextStart.time), end: joinLocalDateTime(nextEnd.date, nextEnd.time) });
  }

  function changeStart(patch: Partial<Part>) {
    const nextStart = { ...start, ...patch };
    const nextEnd = nextEndForStart({ prevStart: start, nextStart, end, endTouched });
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
      <input type="hidden" name={endName} value={endLocal} />
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
          <TimeSelect value={start.time} onChange={(time) => changeStart({ time })} required={required} ariaLabel={`${startLabel} time`} className={inputClassName} />
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
            required={required}
            aria-label={`${endLabel} date`}
            aria-invalid={invalid}
            onChange={(e) => changeEnd({ date: e.target.value })}
            className={inputClassName}
          />
          <TimeSelect value={end.time} onChange={(time) => changeEnd({ time })} required={required} ariaLabel={`${endLabel} time`} className={inputClassName} />
        </div>
      </fieldset>
      {invalid && <p className="text-xs text-red-600">End must be after Start.</p>}
    </div>
  );
}
