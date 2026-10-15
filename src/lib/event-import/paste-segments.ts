// Paste Details — several Events in one paste, ONLY when the person marks
// every Event explicitly:
//
//   EVENT 1
//   …details…
//   === END EVENT 1 ===
//
//   EVENT 2
//   …
//   === END EVENT 2 ===
//
// Deterministic, line-based, strict: every Event must open with its own
// "EVENT n" line and close with the matching "=== END EVENT n ===" line;
// anything else (text between Events, a missing or mismatched END, a
// repeated number, an empty Event) is rejected with the Event it concerns —
// never merged, never dropped. Text without these markers is not touched
// (the single-Event path, with its own multiple-Events refusal, reads it).
// Pure; no I/O.

/** At most this many Events in one paste (never truncated). */
export const PASTE_MAX_EVENTS = 25;

export interface PastedEventSegment {
  /** The number the person gave it ("EVENT 3" → 3). */
  number: number;
  /** The Event's own details, without its markers. */
  text: string;
}

export type PasteSegmentation =
  /** No explicit Event markers — read the paste as one Event. */
  | { kind: "none" }
  | { kind: "segments"; segments: PastedEventSegment[] }
  | { kind: "error"; code: "paste_malformed" | "too_many_events"; detail: string };

const START = /^event\s*#?\s*(\d{1,3})\s*:?$/i;
const END = /^=+\s*end\s+event\s*#?\s*(\d{1,3})\s*=*$/i;

/** Splits a paste into explicitly marked Events (see the file comment). */
export function splitPastedEvents(text: string, minSegmentChars = 1): PasteSegmentation {
  const lines = text.split(/\r?\n/);
  const starts = lines.filter((l) => START.test(l.trim())).length;
  const ends = lines.filter((l) => END.test(l.trim())).length;
  // Markers are explicit opt-in: any END line, or two or more EVENT lines.
  if (ends === 0 && starts < 2) return { kind: "none" };
  if (starts > PASTE_MAX_EVENTS) {
    return { kind: "error", code: "too_many_events", detail: `This paste has ${starts} Events.` };
  }

  const fail = (detail: string): PasteSegmentation => ({ kind: "error", code: "paste_malformed", detail });
  const segments: PastedEventSegment[] = [];
  const seen = new Set<number>();
  let open: { number: number; body: string[] } | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    const start = START.exec(line);
    const end = END.exec(line);
    if (!open) {
      if (!line) continue;
      if (start) {
        const number = Number(start[1]);
        if (seen.has(number)) return fail(`EVENT ${number} appears more than once.`);
        seen.add(number);
        open = { number, body: [] };
        continue;
      }
      if (end) return fail(`"=== END EVENT ${end[1]} ===" has no matching EVENT ${end[1]} line before it.`);
      const before = segments.at(-1);
      return fail(before ? `There is text after "=== END EVENT ${before.number} ===" that isn't inside an Event.` : "There is text before the first EVENT line.");
    }
    if (start) return fail(`EVENT ${open.number} needs its "=== END EVENT ${open.number} ===" line before EVENT ${start[1]} starts.`);
    if (end) {
      if (Number(end[1]) !== open.number) return fail(`EVENT ${open.number} ends with "END EVENT ${end[1]}". The numbers must match.`);
      const body = open.body.join("\n").trim();
      if (body.length < minSegmentChars) return fail(`EVENT ${open.number} is empty.`);
      segments.push({ number: open.number, text: body });
      open = null;
      continue;
    }
    open.body.push(raw);
  }
  if (open) return fail(`EVENT ${open.number} needs an "=== END EVENT ${open.number} ===" line.`);
  if (segments.length > PASTE_MAX_EVENTS) {
    return { kind: "error", code: "too_many_events", detail: `This paste has ${segments.length} Events.` };
  }
  return { kind: "segments", segments };
}
