// In-memory fake of the Supabase service-role client — the PostgREST subset the
// discovery / Target readers use: embeds (incl. !inner, nested), dotted filters on
// embeds, eq/neq/is/in/not/gte/contains, or() with ilike/eq/is/gte/and(), limit,
// insert (business_targets' unique key emulated), update. Shared by tests only.

const FK = { locations: "location_id", opportunity_listings: "listing_id", markets: "market_id", market_areas: "market_area_id", categories: "category_id", businesses: "business_id", events: "event_id" };

function parseSelect(sel) {
  const fields = [];
  let depth = 0, cur = "";
  for (const ch of sel ?? "") {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { fields.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) fields.push(cur.trim());
  return fields.map((f) => {
    const m = f.match(/^(?:(\w+):)?(\w+)(!inner)?\((.*)\)$/s);
    if (!m) return { col: f.split(":").pop() };
    return { embed: true, alias: m[1] ?? m[2], table: m[2], inner: Boolean(m[3]), children: parseSelect(m[4]) };
  });
}

function shape(tables, row, fields) {
  const out = { ...row };
  for (const f of fields.filter((x) => x.embed)) {
    const target = (tables[f.table] ?? []).find((x) => x.id === row[FK[f.table]]) ?? null;
    out[f.alias] = target ? shape(tables, target, f.children) : null;
  }
  return out;
}

const getPath = (row, path) => path.split(".").reduce((v, k) => (v == null ? undefined : v[k]), row);

function splitTop(s) {
  const parts = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

function orTerm(term) {
  const and = term.match(/^and\((.*)\)$/s);
  if (and) { const ps = splitTop(and[1]).map(orTerm); return (r) => ps.every((p) => p(r)); }
  const [col, op, ...rest] = term.split(".");
  const val = rest.join(".");
  if (op === "ilike") { const needle = val.replace(/%/g, "").toLowerCase(); return (r) => String(r[col] ?? "").toLowerCase().includes(needle); }
  if (op === "is") return (r) => (r[col] ?? null) === null;
  if (op === "eq") return (r) => String(r[col]) === val;
  if (op === "gte") return (r) => r[col] != null && String(r[col]) >= val;
  throw new Error(`fake: unsupported or() op ${op}`);
}

export function fakeDb(tables, newId = "00000099-0000-4000-8000-000000000000") {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table, select: null, filters: [], op: "select", payload: null };
      calls.push(call);
      const preds = [];
      let single = null, limit = Infinity, returning = false;
      const pred = (desc, c, fn) => { call.filters.push(`${desc} ${c}`); preds.push((r) => fn(getPath(r, c))); return chain; };
      const chain = {
        select(cols) { if (call.op === "select") call.select = cols; else returning = true; return chain; },
        eq: (c, v) => pred("eq", c, (x) => x === v),
        neq: (c, v) => pred("neq", c, (x) => x !== v),
        is: (c, v) => pred("is", c, (x) => (x ?? null) === v),
        in: (c, vals) => pred("in", c, (x) => vals.includes(x)),
        not: (c, op, v) => pred("not", c, (x) => (x ?? null) !== v),
        gte: (c, v) => pred("gte", c, (x) => x != null && String(x) >= String(v)),
        contains: (c, vals) => pred("contains", c, (x) => Array.isArray(x) && vals.every((v) => x.includes(v))),
        or(expr) { call.filters.push(`or ${expr}`); const ps = splitTop(expr).map(orTerm); preds.push((r) => ps.some((p) => p(r))); return chain; },
        order() { return chain; },
        range() { return chain; },
        limit(n) { limit = n; return chain; },
        insert(payload) { call.op = "insert"; call.payload = payload; return chain; },
        update(payload) { call.op = "update"; call.payload = payload; return chain; },
        delete() { call.op = "delete"; return chain; },
        maybeSingle() { single = "maybe"; return chain; },
        single() { single = "one"; return chain; },
        then(resolve) {
          const rows = tables[table] ?? [];
          if (call.op === "insert" && Array.isArray(call.payload)) {
            const created = call.payload.map((p, i) => ({ id: `${newId.slice(0, -3)}${String(100 + i)}`, ...p }));
            (tables[table] ??= []).push(...created);
            return resolve({ data: returning ? created : null, error: null });
          }
          if (call.op === "insert") {
            const p = call.payload;
            const col = ["target_location_id", "target_business_id", "target_event_id"].find((c) => p[c]);
            if (table === "business_targets" && rows.some((r) => r.business_id === p.business_id && r[col] === p[col])) return resolve({ data: null, error: { code: "23505", message: "duplicate key" } });
            const created = { id: newId, status: "target", ...p };
            (tables[table] ??= []).push(created);
            return resolve({ data: { ...created }, error: null });
          }
          const fields = parseSelect(call.select ?? "*");
          const shaped = rows.map((r) => shape(tables, r, fields));
          const matched = shaped.filter((r) => fields.filter((f) => f.embed && f.inner).every((f) => r[f.alias] != null) && preds.every((p) => p(r)));
          if (call.op === "delete") {
            tables[table] = rows.filter((r) => !preds.every((p) => p(r)));
            return resolve({ data: null, error: null });
          }
          if (call.op === "update") {
            for (const r of rows.filter((r) => matched.some((m) => m.id === r.id))) Object.assign(r, call.payload);
            return resolve({ data: returning ? matched.map((r) => ({ id: r.id })) : null, error: null });
          }
          const data = matched.slice(0, limit);
          if (single) return resolve({ data: data[0] ?? null, error: null });
          return resolve({ data, error: null });
        },
      };
      return chain;
    },
  };
}

