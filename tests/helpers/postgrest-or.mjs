// Test helper — evaluates the PostgREST `.or(...)` filter strings the app
// builds (lib/event-time.ts: occurrenceWindowOr, occurrenceUpcomingOr,
// eventWindowOr, eventUpcomingOr, …) against an in-memory row, so database
// fakes apply the SAME window logic as PostgREST instead of ignoring it.
// Grammar: comma-separated terms; a term is `and(...)`, `or(...)` or
// `col.op.value` with op in eq|neq|lt|lte|gt|gte|is (is.null / is.true …).

function splitTop(s) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const cmp = (a, b) => {
  if (a === null || a === undefined) return null;
  return a < b ? -1 : a > b ? 1 : 0;
};

function term(t) {
  const m = /^(and|or)\((.*)\)$/s.exec(t.trim());
  if (m) {
    const parts = splitTop(m[2]).map(term);
    return m[1] === "and" ? (r) => parts.every((p) => p(r)) : (r) => parts.some((p) => p(r));
  }
  const [col, op, ...rest] = t.trim().split(".");
  let value = rest.join(".");
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
  return (r) => {
    const x = r[col];
    if (op === "is") return value === "null" ? x === null || x === undefined : String(x) === value;
    const c = cmp(x, value);
    if (c === null) return false;
    if (op === "eq") return c === 0;
    if (op === "neq") return c !== 0;
    if (op === "lt") return c < 0;
    if (op === "lte") return c <= 0;
    if (op === "gt") return c > 0;
    if (op === "gte") return c >= 0;
    return true;
  };
}

/** `.or(expr)` → row predicate. */
export function orPredicate(expr) {
  const parts = splitTop(expr).map(term);
  return (r) => parts.some((p) => p(r));
}

/** A fixture row with the calendar dates the database would hold (derived
 * from its real times, app timezone) when a fixture omits them. */
export function withDates(row) {
  const day = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const out = { ...row };
  if (out.occurrence_date === undefined && out.start_at) out.occurrence_date = day(out.start_at);
  if (out.start_date === undefined && out.start_at) out.start_date = day(out.start_at);
  if (out.end_date === undefined) out.end_date = out.end_at ? day(out.end_at) : null;
  return out;
}
