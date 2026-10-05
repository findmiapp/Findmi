"use client";

import { useState } from "react";
import { QUARTER_HOUR_TIMES, formatTimeLabel, isQuarterHour, normalizeTime } from "@/lib/schedule-time";

const EXACT = "__exact";

/**
 * Field QA UX Pass 1 — the shared time control: a quick list of
 * 15-minute times (:00 / :15 / :30 / :45) plus "Exact Time…", which swaps
 * in the native time input for any minute. Quarter hours are only the
 * default way to PICK a time — never a constraint on the value:
 *   - an existing exact time (e.g. 7:07 AM) loads as its own selected
 *     option and saves back unchanged;
 *   - exact mode accepts any minute.
 * Controlled ("HH:MM" or ""). When `name` is given the value is submitted
 * through a hidden input, so form actions read it exactly as before.
 */
export default function TimeSelect({
  value,
  onChange,
  name,
  required,
  placeholder = "Select Time",
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  name?: string;
  required?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const time = normalizeTime(value);
  const [exact, setExact] = useState(false);

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {name && <input type="hidden" name={name} value={time} />}
      {exact ? (
        <input
          type="time"
          value={time}
          required={required}
          aria-label={ariaLabel}
          onChange={(e) => onChange(normalizeTime(e.target.value))}
          className={className}
        />
      ) : (
        <select
          value={time}
          required={required}
          aria-label={ariaLabel}
          onChange={(e) => {
            if (e.target.value === EXACT) setExact(true);
            else onChange(e.target.value);
          }}
          className={className}
        >
          <option value="">{placeholder}</option>
          {(time && !isQuarterHour(time) ? [...QUARTER_HOUR_TIMES, time].sort() : QUARTER_HOUR_TIMES).map((t) => (
            <option key={t} value={t}>
              {formatTimeLabel(t)}
            </option>
          ))}
          <option value={EXACT}>Exact Time…</option>
        </select>
      )}
      {exact && (
        <button type="button" onClick={() => setExact(false)} className="w-fit text-[11px] font-semibold text-ink/45 hover:text-ink">
          Quarter Hours
        </button>
      )}
    </div>
  );
}
