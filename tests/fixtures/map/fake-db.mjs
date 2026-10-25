// In-memory stand-in for the Supabase (PostgREST) query builder — just the
// operators the Discovery Map reads use (eq/neq/in/is/not/gte/lte/lt/gt/
// contains/or, embedded `alias:table!inner(...)` selects, head counts).
// Embeds resolve through the conventional `<table>_id` foreign key.

const FK = { locations: "location_id", events: "event_id", businesses: "business_id" };

function embeds(sel) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of sel ?? "*") {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out
    .map((f) => f.match(/^(?:(\w+):)?(\w+)(?:!\w+)?(!inner)?\((.*)\)$/s))
    .filter(Boolean)
    .map((m) => ({ alias: m[1] ?? m[2], table: m[2], inner: Boolean(m[3]) }));
}
const get = (row, path) => path.split(".").reduce((v, k) => (v == null ? undefined : v[k]), row);
const like = (pat) => new RegExp(`^${pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i");
function split(s) {
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
function term(t, prefix) {
  const and = t.match(/^and\((.*)\)$/s);
  if (and) {
    const parts = split(and[1]).map((x) => term(x, prefix));
    return (r) => parts.every((p) => p(r));
  }
  const [col, op, ...rest] = t.split(".");
  const v = rest.join(".").replace(/^"|"$/g, "");
  const k = prefix + col;
  if (op === "ilike") return (r) => like(v).test(String(get(r, k) ?? ""));
  if (op === "is") return (r) => (get(r, k) ?? null) === null;
  if (op === "eq") return (r) => String(get(r, k)) === v;
  if (op === "lt") return (r) => get(r, k) != null && String(get(r, k)) < v;
  if (op === "gt") return (r) => get(r, k) != null && String(get(r, k)) > v;
  if (op === "gte") return (r) => get(r, k) != null && String(get(r, k)) >= v;
  if (op === "lte") return (r) => get(r, k) != null && String(get(r, k)) <= v;
  throw new Error(`fake-db: unsupported operator ${op}`);
}

export function fakeDb(tables) {
  return {
    from(table) {
      const preds = [];
      let sel = "*";
      let head = false;
      let limit = Infinity;
      let single = false;
      const has = (r, c) => get(r, c) != null;
      const q = {
        select(s, o) {
          sel = s;
          if (o?.head) head = true;
          return q;
        },
        eq: (c, v) => (preds.push((r) => get(r, c) === v), q),
        neq: (c, v) => (preds.push((r) => get(r, c) !== v), q),
        is: (c, v) => (preds.push((r) => (get(r, c) ?? null) === v), q),
        in: (c, v) => (preds.push((r) => v.includes(get(r, c))), q),
        not: (c, _op, v) => (preds.push((r) => (get(r, c) ?? null) !== v), q),
        gte: (c, v) => (preds.push((r) => has(r, c) && get(r, c) >= v), q),
        lte: (c, v) => (preds.push((r) => has(r, c) && get(r, c) <= v), q),
        lt: (c, v) => (preds.push((r) => has(r, c) && get(r, c) < v), q),
        gt: (c, v) => (preds.push((r) => has(r, c) && get(r, c) > v), q),
        contains: (c, v) => (preds.push((r) => Array.isArray(get(r, c)) && v.every((x) => get(r, c).includes(x))), q),
        or(expr, o) {
          const terms = split(expr).map((t) => term(t, o?.referencedTable ? `${o.referencedTable}.` : ""));
          preds.push((r) => terms.some((f) => f(r)));
          return q;
        },
        order: () => q,
        limit: (n) => ((limit = n), q),
        maybeSingle: () => ((single = true), q),
        single: () => ((single = true), q),
        then(resolve) {
          const emb = embeds(sel);
          const rows = (tables[table] ?? []).map((r) => {
            const o = { ...r };
            for (const e of emb) o[e.alias] = (tables[e.table] ?? []).find((x) => x.id === r[FK[e.table]]) ?? null;
            return o;
          });
          const hit = rows.filter((r) => emb.every((e) => !e.inner || r[e.alias]) && preds.every((p) => p(r)));
          if (head) return resolve({ count: hit.length, data: null, error: null });
          return resolve({ data: single ? (hit[0] ?? null) : hit.slice(0, limit), error: null });
        },
      };
      return q;
    },
  };
}
