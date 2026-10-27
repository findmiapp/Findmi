import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { recordAdminAudit } from "@/lib/admin/audit";
import { effectiveTopics, isCurationSource, type Classified, type Provenance } from "./compat-policy";
import { loadClassifications, type ClassificationMap } from "./classifications-server";
import { loadTaxonomyReference, type TaxonomyReference } from "./reference-server";
import {
  CATEGORY_KIND_OF,
  FIELD_SOURCE_ENTITY,
  isAssignable,
  ruleFor,
  type ClassifiedEntityType,
  type DimensionRule,
} from "./cardinality";
import { AUDIENCES, BENEFITS, BUSINESS_MODELS, SETTINGS, type ClassificationDimension, type TaxonomyEntityType, type TermVocabulary } from "./v2";

// Taxonomy V2 — Pass 4A: the Admin classification write primitives
// (server-only). No UI calls these yet; Admin Classification (4B+) will.
//
// Every explicit value written here is source='admin' (assignment rows, or a
// classification_field_sources row for column-stored values). Nothing is
// ever written as source='suggestion': accepting a suggestion writes the
// value through the same path as a manual edit, and only then marks the
// suggestion row confirmed. V1 tables / columns (business_categories,
// event_categories, event_formats, product_categories, locations.category_id,
// events.audience / entry_modes / benefits) are never written.
//
// CURATION — removing or replacing a value of a dimension the compatibility
// layer re-derives from V1 first curates that entity's dimension, in an
// order that never loses an effective value:
//   1. every currently effective value is saved as an explicit admin value
//      (so the effective set is unchanged even if nothing else succeeds);
//   2. the curation marker is written (V1 inference stops for this entity
//      + dimension; the effective set is still unchanged — it is now all
//      explicit);
//   3. the requested change is applied.
// A failure at any step returns an error and leaves an effective set that
// is either unchanged or already correct. Replacing / clearing a SINGLE
// value needs no snapshot (there are no other values to keep): the new
// state is completed first and the marker is written last.
//
// Each operation returns { ok, changed } only after every write it needed
// has succeeded; repeating an operation is harmless (changed: false).

export interface WriteTarget {
  entity: ClassifiedEntityType;
  entityId: string;
  dimension: ClassificationDimension;
}

export type WriteErrorCode =
  | "not_found"
  | "not_writable"
  | "service"
  | "invalid_value"
  | "not_assignable"
  | "required"
  | "ambiguous"
  | "not_effective"
  | "already_reviewed"
  | "unsupported"
  | "db";

export type WriteResult = { ok: true; changed: boolean } | { ok: false; code: WriteErrorCode; error: string };

export interface WriteOptions {
  client?: SupabaseClient;
  reference?: TaxonomyReference;
  /** ISO timestamp source (tests). */
  now?: () => string;
}

interface Ctx {
  client: SupabaseClient;
  ref: TaxonomyReference;
  now: () => string;
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const OK = (changed: boolean): WriteResult => ({ ok: true, changed });
const fail = (code: WriteErrorCode, error: string): WriteResult => ({ ok: false, code, error });
const dbFail = (what: string, message: string): WriteResult => fail("db", `${what}: ${message}`);

async function context(opts: WriteOptions): Promise<Ctx> {
  const client = opts.client ?? getAdminSupabase();
  if (!client) throw new Error("taxonomy admin writes: service-role client unavailable");
  return { client, ref: opts.reference ?? (await loadTaxonomyReference()), now: opts.now ?? (() => new Date().toISOString()) };
}

// ------------------------------------------------------------ stores

interface RowStore {
  kind: "rows";
  table: string;
  entityCol: string;
  valueCol: "category_id" | "term_id" | "topic_id";
  /** Rows carry is_primary. */
  primary: boolean;
}
interface ColumnStore {
  kind: "column";
  table: string;
  column: string;
  /** classification_field_sources.field for the column's provenance. */
  field: string;
  array: boolean;
}
type Store = RowStore | ColumnStore;

const rows = (table: string, entityCol: string, valueCol: RowStore["valueCol"], primary = false): RowStore => ({ kind: "rows", table, entityCol, valueCol, primary });
const column = (table: string, col: string, field: string, array: boolean): ColumnStore => ({ kind: "column", table, column: col, field, array });

/** Where each writable entity × dimension lives. */
const STORES: Record<string, Store> = {
  "business:category": rows("business_category_assignments", "business_id", "category_id", true),
  "location:category": rows("location_categories", "location_id", "category_id", true),
  "event:category": rows("event_category_assignments", "event_id", "category_id", true),
  "product:category": rows("product_category_assignments", "product_id", "category_id", true),
  "event:event_type": rows("event_type_assignments", "event_id", "term_id", true),
  "event:experience_mechanic": rows("event_mechanic_assignments", "event_id", "term_id"),
  "business:topic": rows("business_topics", "business_id", "topic_id"),
  "location:topic": rows("location_topics", "location_id", "topic_id"),
  "event:topic": rows("event_topics", "event_id", "topic_id"),
  "product:topic": rows("product_topics", "product_id", "topic_id"),
  "appearance:topic": rows("appearance_topics", "appearance_id", "topic_id"),
  "business:business_model": column("businesses", "business_models", "business_models", true),
  "event:setting": column("events", "setting", "setting", false),
  "product:audience": column("products", "audience", "audience", true),
  "appearance:appearance_type": column("appearances", "appearance_type_id", "appearance_type", false),
  "appearance:benefit": column("appearances", "benefits", "benefits", true),
  "opportunity:opportunity_category": column("opportunity_listings", "opportunity_category_id", "opportunity_category", false),
};

const ENTITY_TABLE: Record<ClassifiedEntityType, string> = {
  business: "businesses",
  location: "locations",
  event: "events",
  product: "products",
  appearance: "appearances",
  opportunity: "opportunity_listings",
};

const TERM_DIMENSIONS: readonly ClassificationDimension[] = ["event_type", "experience_mechanic", "appearance_type", "opportunity_category"];
const CODES: Partial<Record<ClassificationDimension, readonly string[]>> = {
  business_model: BUSINESS_MODELS,
  setting: SETTINGS,
  audience: AUDIENCES,
  benefit: BENEFITS,
};

// ------------------------------------------------------------ checks

interface Resolved {
  rule: DimensionRule;
  store: Store;
}

/** The rule + store for a writable target, after checking the entity exists
 * (and, for Products, is not a Service). */
async function resolveTarget(c: Ctx, t: WriteTarget): Promise<Resolved | WriteResult> {
  const rule = ruleFor(t.entity, t.dimension);
  if (!rule) return fail("not_writable", `${t.entity} has no ${t.dimension} classification`);
  if (rule.write !== "admin") {
    return fail("not_writable", rule.write === "live_v1" ? `${t.dimension} is a live public field; edit it in Discovery Details` : `${t.dimension} is not part of Admin classification yet`);
  }
  const store = STORES[`${t.entity}:${t.dimension}`];
  if (!store) return fail("not_writable", `${t.entity} ${t.dimension} has no store`);
  const cols = t.entity === "product" ? "id, product_type" : "id";
  const { data, error } = await c.client.from(ENTITY_TABLE[t.entity]).select(cols).eq("id", t.entityId).maybeSingle();
  if (error) return dbFail(ENTITY_TABLE[t.entity], error.message);
  if (!data) return fail("not_found", `${t.entity} ${t.entityId} not found`);
  if (t.entity === "product" && (data as unknown as Row).product_type === "service") return fail("service", "Services are not Products and are not classified as Products");
  return { rule, store };
}
const isResult = (x: Resolved | WriteResult): x is WriteResult => "ok" in x;

/** A value that may be NEWLY assigned: it exists, belongs to this
 * dimension (and Category tree / Topic scope) and is not retired. */
function checkAssignable(c: Ctx, t: WriteTarget, value: string): WriteResult | null {
  if (t.dimension === "category") {
    const node = c.ref.category(value);
    if (!node || node.kind !== CATEGORY_KIND_OF[t.entity]) return fail("invalid_value", `not a ${CATEGORY_KIND_OF[t.entity]} Category in the V2 tree`);
    return isAssignable("category", node.status) ? null : fail("not_assignable", `Category ${node.slug} is ${node.status}`);
  }
  if (TERM_DIMENSIONS.includes(t.dimension)) {
    const term = c.ref.term(value);
    if (!term || term.vocabulary !== t.dimension) return fail("invalid_value", `not a ${t.dimension} term`);
    return isAssignable("term", term.status) ? null : fail("not_assignable", `${term.slug} is ${term.status}`);
  }
  if (t.dimension === "topic") {
    const topic = c.ref.topic(value);
    if (!topic) return fail("invalid_value", "unknown Topic");
    if (!isAssignable("topic", topic.status)) return fail("not_assignable", `Topic ${topic.slug} is ${topic.status}`);
    return c.ref.topicAppliesTo(value, t.entity as TaxonomyEntityType) ? null : fail("invalid_value", `Topic ${topic.slug} does not apply to ${t.entity}`);
  }
  const codes = CODES[t.dimension];
  return codes && codes.includes(value) ? null : fail("invalid_value", `${value} is not a ${t.dimension}`);
}

// ------------------------------------------------------------ effective state

interface Effective {
  values: string[];
  primary: string | null;
}

const idsOf = (xs: readonly Classified<{ id: string }, Provenance>[]) => xs.map((x) => x.value.id);

/** The entity's current effective values for one dimension, as stored ids /
 * codes, answered by the compatibility layer. */
async function effective(c: Ctx, t: WriteTarget, rule: DimensionRule): Promise<Effective> {
  const loaded = await loadClassifications(t.entity, [t.entityId], { client: c.client, reference: c.ref, dimensions: [rule.compat], context: false });
  const cls = loaded.get(t.entityId) as ClassificationMap[ClassifiedEntityType] | undefined;
  if (!cls) return { values: [], primary: null };
  const one = (x: Classified<{ id: string }, Provenance> | null | undefined): Effective => ({ values: x ? [x.value.id] : [], primary: x?.value.id ?? null });
  switch (t.entity) {
    case "business": {
      const b = cls as ClassificationMap["business"];
      if (t.dimension === "category") return { values: idsOf(b.categories), primary: b.primaryCategory?.value.id ?? null };
      if (t.dimension === "topic") return { values: idsOf(effectiveTopics(b.topics)), primary: null };
      return { values: b.businessModels.map((m) => m.value), primary: null };
    }
    case "location": {
      const l = cls as ClassificationMap["location"];
      return t.dimension === "category" ? { values: idsOf(l.categories), primary: l.primaryCategory?.value.id ?? null } : { values: idsOf(effectiveTopics(l.topics)), primary: null };
    }
    case "product": {
      const p = cls as ClassificationMap["product"];
      if (t.dimension === "category") return { values: idsOf(p.categories), primary: p.primaryCategory?.value.id ?? null };
      if (t.dimension === "topic") return { values: idsOf(effectiveTopics(p.topics)), primary: null };
      return { values: p.audience.map((a) => a.value), primary: null };
    }
    case "event": {
      const e = cls as ClassificationMap["event"];
      if (t.dimension === "category") return { values: idsOf(e.domains), primary: e.primaryDomain?.value.id ?? null };
      if (t.dimension === "event_type") return { values: idsOf(e.types), primary: e.primaryType?.value.id ?? null };
      if (t.dimension === "experience_mechanic") return { values: idsOf(e.mechanics), primary: null };
      if (t.dimension === "topic") return { values: idsOf(effectiveTopics(e.topics)), primary: null };
      return { values: e.setting ? [e.setting.value] : [], primary: e.setting?.value ?? null };
    }
    case "appearance": {
      const a = cls as ClassificationMap["appearance"];
      if (t.dimension === "appearance_type") return one(a.own.appearanceType);
      if (t.dimension === "topic") return { values: idsOf(a.own.topics), primary: null };
      return { values: a.own.benefits.map((b) => b.value), primary: null };
    }
    case "opportunity":
      return one((cls as ClassificationMap["opportunity"]).category);
  }
}

// ------------------------------------------------------------ row / column / field-source helpers

async function readRows(c: Ctx, s: RowStore, entityId: string): Promise<Row[] | string> {
  const { data, error } = await c.client.from(s.table).select(s.primary ? `${s.valueCol}, source, is_primary` : `${s.valueCol}, source`).eq(s.entityCol, entityId);
  return error ? `${s.table}: ${error.message}` : ((data ?? []) as unknown as Row[]);
}

/** Makes `value` an explicit row: inserts it (never primary), or upgrades a
 * non-durable (migration / suggestion) row to admin. An existing durable row
 * (admin / owner / importer) keeps its own provenance. */
async function putRow(c: Ctx, s: RowStore, entityId: string, value: string, existing: readonly Row[]): Promise<{ changed: boolean } | string> {
  const row = existing.find((r) => str(r[s.valueCol]) === value);
  if (row && isCurationSource(str(row.source))) return { changed: false };
  if (row) {
    const { error } = await c.client.from(s.table).update({ source: "admin" }).eq(s.entityCol, entityId).eq(s.valueCol, value);
    return error ? `${s.table}: ${error.message}` : { changed: true };
  }
  const { error } = await c.client.from(s.table).insert([{ [s.entityCol]: entityId, [s.valueCol]: value, source: "admin", ...(s.primary ? { is_primary: false } : {}) }]);
  return error ? `${s.table}: ${error.message}` : { changed: true };
}

/** Exactly one primary row (`value`), or none when `value` is null. Clears
 * the others first (the unique one-primary index), then sets it. */
async function setPrimaryRow(c: Ctx, s: RowStore, entityId: string, value: string | null, existing: readonly Row[]): Promise<{ changed: boolean } | string> {
  const others = existing.filter((r) => r.is_primary === true && str(r[s.valueCol]) !== value);
  const already = value !== null && existing.some((r) => r.is_primary === true && str(r[s.valueCol]) === value);
  if (others.length) {
    let q = c.client.from(s.table).update({ is_primary: false }).eq(s.entityCol, entityId).eq("is_primary", true);
    if (value !== null) q = q.neq(s.valueCol, value);
    const { error } = await q;
    if (error) return `${s.table}: ${error.message}`;
  }
  if (value !== null && !already) {
    const { error } = await c.client.from(s.table).update({ is_primary: true }).eq(s.entityCol, entityId).eq(s.valueCol, value);
    if (error) return `${s.table}: ${error.message}`;
  }
  return { changed: others.length > 0 || (value !== null && !already) };
}

async function readFieldSource(c: Ctx, entity: ClassifiedEntityType, entityId: string, field: string): Promise<string | null | { error: string }> {
  const { data, error } = await c.client.from("classification_field_sources").select("source").eq("entity_type", FIELD_SOURCE_ENTITY[entity]).eq("entity_id", entityId).eq("field", field).maybeSingle();
  if (error) return { error: `classification_field_sources: ${error.message}` };
  return data ? str((data as Row).source) : null;
}

/** Records Admin as the writer of `field` (column provenance, or a
 * curation marker). */
async function putFieldSource(c: Ctx, entity: ClassifiedEntityType, entityId: string, field: string): Promise<{ changed: boolean } | string> {
  const cur = await readFieldSource(c, entity, entityId, field);
  if (cur !== null && typeof cur === "object") return cur.error;
  if (cur === "admin") return { changed: false };
  const values = { source: "admin", set_at: c.now(), set_by: null };
  const { error } =
    cur === null
      ? await c.client.from("classification_field_sources").insert([{ entity_type: FIELD_SOURCE_ENTITY[entity], entity_id: entityId, field, ...values }])
      : await c.client.from("classification_field_sources").update(values).eq("entity_type", FIELD_SOURCE_ENTITY[entity]).eq("entity_id", entityId).eq("field", field);
  return error ? `classification_field_sources: ${error.message}` : { changed: true };
}

async function readColumn(c: Ctx, s: ColumnStore, entityId: string): Promise<unknown | { error: string }> {
  const { data, error } = await c.client.from(s.table).select(s.column).eq("id", entityId).maybeSingle();
  if (error) return { error: `${s.table}: ${error.message}` };
  return (data as Row | null)?.[s.column] ?? null;
}
const arrayOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const isErr = (v: unknown): v is { error: string } => typeof v === "object" && v !== null && !Array.isArray(v) && "error" in v;

async function writeColumn(c: Ctx, s: ColumnStore, entityId: string, value: unknown): Promise<string | null> {
  const { error } = await c.client.from(s.table).update({ [s.column]: value }).eq("id", entityId);
  return error ? `${s.table}: ${error.message}` : null;
}

async function audit(c: Ctx, action: string, t: WriteTarget, detail: Record<string, unknown>) {
  await recordAdminAudit(c.client, { action, actor: { kind: "admin" }, targetType: t.entity, targetId: t.entityId, detail: { dimension: t.dimension, ...detail } });
}

// ------------------------------------------------------------ curation

/** Curates the dimension for this entity (see the header): snapshot the
 * effective set as explicit admin values, then write the marker. No-op for
 * dimensions without V1 inference and for already-curated ones. */
async function ensureCurated(c: Ctx, t: WriteTarget, r: Resolved): Promise<WriteResult> {
  const field = r.rule.curationField;
  if (!field) return OK(false);
  const marker = await readFieldSource(c, t.entity, t.entityId, field);
  if (marker !== null && typeof marker === "object") return dbFail("curation", marker.error);
  if (isCurationSource(marker)) return OK(false);

  const eff = await effective(c, t, r.rule);
  if (r.rule.cardinality === "single" && eff.values.length > 1 && !eff.primary) return fail("ambiguous", `${t.dimension} has ${eff.values.length} inferred values; choose one (replace) instead`);
  if (r.rule.cardinality === "single" && r.rule.required && eff.values.length === 0) return fail("required", `${t.dimension} is required; set a value instead`);

  // 1. Every effective value becomes an explicit admin value.
  if (r.store.kind === "rows") {
    const s = r.store;
    const existing = await readRows(c, s, t.entityId);
    if (typeof existing === "string") return dbFail("curation", existing);
    const keep = r.rule.cardinality === "single" ? (eff.primary ? [eff.primary] : eff.values.slice(0, 1)) : eff.values;
    for (const v of keep) {
      const put = await putRow(c, s, t.entityId, v, existing);
      if (typeof put === "string") return dbFail("curation", put);
    }
    if (s.primary && keep.length) {
      const fresh = await readRows(c, s, t.entityId);
      if (typeof fresh === "string") return dbFail("curation", fresh);
      const pr = await setPrimaryRow(c, s, t.entityId, eff.primary && keep.includes(eff.primary) ? eff.primary : keep[0], fresh);
      if (typeof pr === "string") return dbFail("curation", pr);
    }
  } else {
    // business_models: the whole effective set into the column.
    const err = await writeColumn(c, r.store, t.entityId, eff.values);
    if (err) return dbFail("curation", err);
  }
  // 2. The marker — V1 inference stops for this entity + dimension.
  const mark = await putFieldSource(c, t.entity, t.entityId, field);
  if (typeof mark === "string") return dbFail("curation", mark);
  await audit(c, "taxonomy_dimension_curate", t, { values: eff.values.length });
  return OK(true);
}

/** Curates one entity's dimension without changing its values. */
export async function curateDimension(t: WriteTarget, opts: WriteOptions = {}): Promise<WriteResult> {
  const c = await context(opts);
  const r = await resolveTarget(c, t);
  if (isResult(r)) return r;
  return ensureCurated(c, t, r);
}

// ------------------------------------------------------------ operations

/** Adds a value. A SINGLE dimension is replaced instead. Adding never
 * curates a row-backed dimension: V1 inference keeps contributing. */
export async function addAssignment(t: WriteTarget, value: string, opts: WriteOptions = {}): Promise<WriteResult> {
  const c = await context(opts);
  const r = await resolveTarget(c, t);
  if (isResult(r)) return r;
  if (r.rule.cardinality === "single") return replaceIn(c, t, r, value);
  const bad = checkAssignable(c, t, value);
  if (bad) return bad;

  if (r.store.kind === "rows") {
    const s = r.store;
    const before = s.primary ? await effective(c, t, r.rule) : null;
    const existing = await readRows(c, s, t.entityId);
    if (typeof existing === "string") return dbFail("add", existing);
    const put = await putRow(c, s, t.entityId, value, existing);
    if (typeof put === "string") return dbFail("add", put);
    let changed = put.changed;
    // The first Category becomes primary; otherwise a curated set without a
    // primary gets this one (so a non-empty curated set always has one).
    if (s.primary && before) {
      const fresh = await readRows(c, s, t.entityId);
      if (typeof fresh === "string") return dbFail("add", fresh);
      const hasExplicitPrimary = fresh.some((x) => x.is_primary === true && isCurationSource(str(x.source)));
      const curated = isCurationSource(str(await fieldOrNull(c, t, r)));
      if (!hasExplicitPrimary && (before.values.length === 0 || (curated && !before.primary))) {
        const pr = await setPrimaryRow(c, s, t.entityId, value, fresh);
        if (typeof pr === "string") return dbFail("add", pr);
        changed = changed || pr.changed;
      }
    }
    if (changed) await audit(c, "taxonomy_assign_add", t, { value });
    return OK(changed);
  }

  const s = r.store;
  // A whole-set column (business_models) is curated first so its V1-inferred
  // values are kept as explicit values.
  if (r.rule.curationField) {
    const cur = await ensureCurated(c, t, r);
    if (!cur.ok) return cur;
  }
  const raw = await readColumn(c, s, t.entityId);
  if (isErr(raw)) return dbFail("add", raw.error);
  const current = arrayOf(raw);
  let changed = false;
  if (!current.includes(value)) {
    const err = await writeColumn(c, s, t.entityId, [...current, value]);
    if (err) return dbFail("add", err);
    changed = true;
  }
  const src = await putFieldSource(c, t.entity, t.entityId, s.field);
  if (typeof src === "string") return dbFail("add", src);
  changed = changed || src.changed;
  if (changed) await audit(c, "taxonomy_assign_add", t, { value });
  return OK(changed);
}

async function fieldOrNull(c: Ctx, t: WriteTarget, r: Resolved): Promise<string | null> {
  const field = r.rule.curationField;
  if (!field) return null;
  const v = await readFieldSource(c, t.entity, t.entityId, field);
  return typeof v === "string" ? v : null;
}

/** Removes a value deliberately. On a V1-inferred dimension this curates it
 * first, so V1 cannot bring the value back. Removing a SINGLE value clears
 * it (refused when the dimension is required). */
export async function removeAssignment(t: WriteTarget, value: string, opts: WriteOptions = {}): Promise<WriteResult> {
  const c = await context(opts);
  const r = await resolveTarget(c, t);
  if (isResult(r)) return r;
  if (r.rule.cardinality === "single") {
    if (r.rule.required) return fail("required", `${t.dimension} is required; replace it instead`);
    const eff = await effective(c, t, r.rule);
    if (!eff.values.includes(value)) return OK(false);
    return clearIn(c, t, r);
  }
  const cur = await ensureCurated(c, t, r);
  if (!cur.ok) return cur;
  let changed = cur.changed;

  if (r.store.kind === "rows") {
    const s = r.store;
    const existing = await readRows(c, s, t.entityId);
    if (typeof existing === "string") return dbFail("remove", existing);
    const row = existing.find((x) => str(x[s.valueCol]) === value);
    if (row) {
      const { error } = await c.client.from(s.table).delete().eq(s.entityCol, t.entityId).eq(s.valueCol, value);
      if (error) return dbFail("remove", `${s.table}: ${error.message}`);
      changed = true;
      // The primary was removed: the next remaining value takes over.
      if (s.primary && row.is_primary === true) {
        const rest = existing.filter((x) => str(x[s.valueCol]) !== value && isCurationSource(str(x.source)));
        if (rest.length) {
          const pr = await setPrimaryRow(c, s, t.entityId, str(rest[0][s.valueCol]), rest);
          if (typeof pr === "string") return dbFail("remove", pr);
        }
      }
    }
  } else {
    const s = r.store;
    const raw = await readColumn(c, s, t.entityId);
    if (isErr(raw)) return dbFail("remove", raw.error);
    const current = arrayOf(raw);
    if (current.includes(value)) {
      const err = await writeColumn(c, s, t.entityId, current.filter((v) => v !== value));
      if (err) return dbFail("remove", err);
      changed = true;
    }
    const src = await putFieldSource(c, t.entity, t.entityId, s.field);
    if (typeof src === "string") return dbFail("remove", src);
    changed = changed || src.changed;
  }
  if (changed) await audit(c, "taxonomy_assign_remove", t, { value });
  return OK(changed);
}

/** Replaces a SINGLE dimension's value with `value`. */
export async function replaceSingle(t: WriteTarget, value: string, opts: WriteOptions = {}): Promise<WriteResult> {
  const c = await context(opts);
  const r = await resolveTarget(c, t);
  if (isResult(r)) return r;
  if (r.rule.cardinality !== "single") return fail("unsupported", `${t.dimension} is not a single-valued dimension`);
  return replaceIn(c, t, r, value);
}

async function replaceIn(c: Ctx, t: WriteTarget, r: Resolved, value: string): Promise<WriteResult> {
  const bad = checkAssignable(c, t, value);
  if (bad) return bad;
  let changed = false;
  if (r.store.kind === "rows") {
    const s = r.store;
    // New value in place first, then the others go, then it becomes primary,
    // and only then the marker: the old value never vanishes before the new
    // one exists.
    const existing = await readRows(c, s, t.entityId);
    if (typeof existing === "string") return dbFail("replace", existing);
    const put = await putRow(c, s, t.entityId, value, existing);
    if (typeof put === "string") return dbFail("replace", put);
    changed = put.changed;
    if (existing.some((x) => str(x[s.valueCol]) !== value)) {
      const { error } = await c.client.from(s.table).delete().eq(s.entityCol, t.entityId).neq(s.valueCol, value);
      if (error) return dbFail("replace", `${s.table}: ${error.message}`);
      changed = true;
    }
    const fresh = await readRows(c, s, t.entityId);
    if (typeof fresh === "string") return dbFail("replace", fresh);
    const pr = await setPrimaryRow(c, s, t.entityId, value, fresh);
    if (typeof pr === "string") return dbFail("replace", pr);
    changed = changed || pr.changed;
    const field = r.rule.curationField;
    if (field) {
      const mark = await putFieldSource(c, t.entity, t.entityId, field);
      if (typeof mark === "string") return dbFail("replace", mark);
      changed = changed || mark.changed;
    }
  } else {
    const s = r.store;
    const raw = await readColumn(c, s, t.entityId);
    if (isErr(raw)) return dbFail("replace", raw.error);
    if (raw !== value) {
      const err = await writeColumn(c, s, t.entityId, value);
      if (err) return dbFail("replace", err);
      changed = true;
    }
    const src = await putFieldSource(c, t.entity, t.entityId, s.field);
    if (typeof src === "string") return dbFail("replace", src);
    changed = changed || src.changed;
  }
  if (changed) await audit(c, "taxonomy_assign_replace", t, { value });
  return OK(changed);
}

/** Clears an optional SINGLE dimension: an explicit empty that V1 inference
 * cannot refill. Refused for required dimensions. */
export async function clearSingle(t: WriteTarget, opts: WriteOptions = {}): Promise<WriteResult> {
  const c = await context(opts);
  const r = await resolveTarget(c, t);
  if (isResult(r)) return r;
  if (r.rule.cardinality !== "single") return fail("unsupported", `${t.dimension} is not a single-valued dimension`);
  if (r.rule.required) return fail("required", `${t.dimension} is required; replace it instead`);
  return clearIn(c, t, r);
}

async function clearIn(c: Ctx, t: WriteTarget, r: Resolved): Promise<WriteResult> {
  let changed = false;
  if (r.store.kind === "rows") {
    const s = r.store;
    const existing = await readRows(c, s, t.entityId);
    if (typeof existing === "string") return dbFail("clear", existing);
    if (existing.length) {
      const { error } = await c.client.from(s.table).delete().eq(s.entityCol, t.entityId);
      if (error) return dbFail("clear", `${s.table}: ${error.message}`);
      changed = true;
    }
    const field = r.rule.curationField;
    if (field) {
      const mark = await putFieldSource(c, t.entity, t.entityId, field);
      if (typeof mark === "string") return dbFail("clear", mark);
      changed = changed || mark.changed;
    }
  } else {
    const s = r.store;
    const raw = await readColumn(c, s, t.entityId);
    if (isErr(raw)) return dbFail("clear", raw.error);
    if (raw !== null) {
      const err = await writeColumn(c, s, t.entityId, null);
      if (err) return dbFail("clear", err);
      changed = true;
    }
    const src = await putFieldSource(c, t.entity, t.entityId, s.field);
    if (typeof src === "string") return dbFail("clear", src);
    changed = changed || src.changed;
  }
  if (changed) await audit(c, "taxonomy_assign_clear", t, {});
  return OK(changed);
}

/** Designates `value` the primary Category of a multi Category dimension.
 * It must already be effective; it becomes an explicit admin value if it
 * was only inferred. */
export async function setPrimary(t: WriteTarget, value: string, opts: WriteOptions = {}): Promise<WriteResult> {
  const c = await context(opts);
  const r = await resolveTarget(c, t);
  if (isResult(r)) return r;
  if (r.store.kind !== "rows" || !r.rule.primary) return fail("unsupported", `${t.dimension} has no primary designation`);
  const s = r.store;
  const eff = await effective(c, t, r.rule);
  if (!eff.values.includes(value)) return fail("not_effective", "add the value before making it primary");
  const existing = await readRows(c, s, t.entityId);
  if (typeof existing === "string") return dbFail("primary", existing);
  const put = await putRow(c, s, t.entityId, value, existing);
  if (typeof put === "string") return dbFail("primary", put);
  const fresh = await readRows(c, s, t.entityId);
  if (typeof fresh === "string") return dbFail("primary", fresh);
  const pr = await setPrimaryRow(c, s, t.entityId, value, fresh);
  if (typeof pr === "string") return dbFail("primary", pr);
  const changed = put.changed || pr.changed;
  if (changed) await audit(c, "taxonomy_primary_set", t, { value });
  return OK(changed);
}

// ------------------------------------------------------------ suggestions

const SUGGESTION_ENTITY: Record<string, ClassifiedEntityType | undefined> = {
  business: "business",
  location: "location",
  event: "event",
  product: "product",
  appearance: "appearance",
  opportunity_listing: "opportunity",
};

/** A suggestion's stored value (a slug or code) → the id / code a write
 * takes. */
function suggestedValue(c: Ctx, entity: ClassifiedEntityType, dimension: ClassificationDimension, raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (dimension === "category") {
    const kind = CATEGORY_KIND_OF[entity];
    return kind ? (c.ref.categoryBySlug(kind, raw)?.id ?? null) : null;
  }
  if (TERM_DIMENSIONS.includes(dimension)) return c.ref.termBySlug(dimension as TermVocabulary, raw)?.id ?? null;
  if (dimension === "topic") return c.ref.topicBySlug(raw)?.id ?? null;
  return raw;
}

export interface ReviewOptions extends WriteOptions {
  note?: string;
}

/** Accept: write the value through the normal Admin path (source='admin'),
 * and only after that succeeds mark the suggestion confirmed. Safe to
 * re-run after a partial failure. */
export async function acceptSuggestion(suggestionId: string, opts: ReviewOptions = {}): Promise<WriteResult> {
  const c = await context(opts);
  const { data, error } = await c.client.from("classification_suggestions").select("id, entity_type, entity_id, dimension, value, status").eq("id", suggestionId).maybeSingle();
  if (error) return dbFail("classification_suggestions", error.message);
  if (!data) return fail("not_found", "suggestion not found");
  const sug = data as Row;
  if (sug.status === "confirmed") return OK(false);
  if (sug.status === "rejected") return fail("already_reviewed", "this suggestion was dismissed");
  const entity = SUGGESTION_ENTITY[str(sug.entity_type)];
  const dimension = str(sug.dimension) as ClassificationDimension;
  if (!entity) return fail("unsupported", `${str(sug.entity_type)} suggestions are not reviewed here`);
  const rule = ruleFor(entity, dimension);
  if (!rule || rule.write !== "admin") return fail("not_writable", rule?.write === "live_v1" ? `${dimension} is a live public field; edit it in Discovery Details` : `${dimension} suggestions are not reviewed here`);
  const value = suggestedValue(c, entity, dimension, sug.value);
  if (!value) return fail("invalid_value", "the suggested value no longer exists");

  const t: WriteTarget = { entity, entityId: str(sug.entity_id), dimension };
  const write = rule.cardinality === "single" ? await replaceSingle(t, value, { client: c.client, reference: c.ref, now: c.now }) : await addAssignment(t, value, { client: c.client, reference: c.ref, now: c.now });
  if (!write.ok) return write;

  const { error: upd } = await c.client
    .from("classification_suggestions")
    .update({ status: "confirmed", reviewed_at: c.now(), reviewed_by: null, review_note: opts.note?.slice(0, 500) ?? null })
    .eq("id", suggestionId)
    .eq("status", "suggested");
  if (upd) return dbFail("classification_suggestions", upd.message);
  await audit(c, "taxonomy_suggestion_accept", t, { suggestion_id: suggestionId, value });
  return OK(true);
}

/** Dismiss: mark rejected; no assignment is written. */
export async function dismissSuggestion(suggestionId: string, opts: ReviewOptions = {}): Promise<WriteResult> {
  const c = await context(opts);
  const { data, error } = await c.client.from("classification_suggestions").select("id, entity_type, entity_id, dimension, status").eq("id", suggestionId).maybeSingle();
  if (error) return dbFail("classification_suggestions", error.message);
  if (!data) return fail("not_found", "suggestion not found");
  const sug = data as Row;
  if (sug.status === "rejected") return OK(false);
  if (sug.status === "confirmed") return fail("already_reviewed", "this suggestion was accepted");
  const { error: upd } = await c.client
    .from("classification_suggestions")
    .update({ status: "rejected", reviewed_at: c.now(), reviewed_by: null, review_note: opts.note?.slice(0, 500) ?? null })
    .eq("id", suggestionId)
    .eq("status", "suggested");
  if (upd) return dbFail("classification_suggestions", upd.message);
  await recordAdminAudit(c.client, {
    action: "taxonomy_suggestion_dismiss",
    actor: { kind: "admin" },
    targetType: SUGGESTION_ENTITY[str(sug.entity_type)] ?? str(sug.entity_type),
    targetId: str(sug.entity_id),
    detail: { dimension: str(sug.dimension), suggestion_id: suggestionId },
  });
  return OK(true);
}
