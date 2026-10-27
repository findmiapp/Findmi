// Pages + Sections V1B — the settings of the Section types that live in
// homepage_rows.config: Entity Results, Text & Editorial and Map. Pure (no
// I/O): validation (strict — unknown keys are errors, so stored config can
// never carry instructions the renderer doesn't understand), scope-aware
// normalization, the Manual / Dynamic / Hybrid composition rule, the safe
// Text & Editorial parser, and the Admin summary lines. Resolution against
// real data lives in lib/page-sections-server.ts.
import { z } from "zod";
import { validateCustomDestination } from "./navigation";
import { WHEN_LABELS } from "./discovery/query";
import {
  ENTITY_MODES,
  ENTITY_MODE_LABELS,
  ENTITY_REF_KINDS,
  ENTITY_SCOPES,
  ENTITY_SCOPE_LABELS,
  RESULT_WHEN,
  SCOPE_FILTERS,
  SCOPE_REF_KINDS,
  SECTION_LIMITS,
  type EntityRefKind,
  type EntityScope,
  type PageSectionKind,
} from "./section-types";

const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const dateKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
const flag = z.literal(true).optional();
const httpsImage = z.string().max(2048).regex(/^https:\/\/\S+$/i);

export const entityRefSchema = z.object({ kind: z.enum(ENTITY_REF_KINDS), id: uuid }).strict();
export type EntityRef = z.infer<typeof entityRefSchema>;
export const refKey = (r: { kind: string; id: string }) => `${r.kind}:${r.id}`;

export const resultFiltersSchema = z
  .object({
    when: z.enum(RESULT_WHEN).optional(),
    date: dateKey.optional(),
    from: dateKey.optional(),
    to: dateKey.optional(),
    categories: z.array(slug).max(8).optional(),
    formats: z.array(slug).max(8).optional(),
    text: z.string().trim().min(1).max(100).optional(),
    brands: z.array(uuid).max(SECTION_LIMITS.filterIds).optional(),
    places: z.array(uuid).max(SECTION_LIMITS.filterIds).optional(),
    free: flag,
    family: flag,
    rsvp: flag,
    tickets: flag,
    featured: flag,
    endingSoon: flag,
    justAnnounced: flag,
  })
  .strict()
  .refine((f) => !(f.from && f.to) || f.from <= f.to, { message: "The date range ends before it starts.", path: ["to"] });
export type ResultFilters = z.infer<typeof resultFiltersSchema>;

const refList = z.array(entityRefSchema).max(SECTION_LIMITS.refsPerList);

export const entityResultsConfigSchema = z
  .object({
    scope: z.enum(ENTITY_SCOPES),
    mode: z.enum(ENTITY_MODES),
    filters: resultFiltersSchema.default({}),
    includes: refList.default([]),
    excludes: refList.default([]),
    pins: refList.default([]),
    limit: z.number().int().min(1).max(SECTION_LIMITS.itemsPerSection).default(12),
    layout: z.enum(["carousel", "grid"]).default("carousel"),
  })
  .strict();
export type EntityResultsConfig = z.infer<typeof entityResultsConfigSchema>;

export const richTextConfigSchema = z
  .object({
    body: z.string().max(SECTION_LIMITS.textBody).default(""),
    image_url: httpsImage.optional(),
    image_alt: z.string().max(200).optional(),
    cta_label: z.string().trim().min(1).max(40).optional(),
    cta_url: z.string().max(2048).optional(),
  })
  .strict()
  .refine((c) => Boolean(c.cta_label) === Boolean(c.cta_url), { message: "A call to action needs both a label and a destination.", path: ["cta_url"] })
  .refine((c) => !c.cta_url || validateCustomDestination(c.cta_url).ok, { message: "CTA destination must be an https:// link or a Findmi path starting with /.", path: ["cta_url"] });
export type RichTextConfig = z.infer<typeof richTextConfigSchema>;

/** Map: which Entity Results Sections of the same Page it plots (empty =
 * every Entity Results Section on the Page). */
export const mapConfigSchema = z.object({ sections: z.array(uuid).max(SECTION_LIMITS.sectionsPerPage).default([]) }).strict();
export type MapConfig = z.infer<typeof mapConfigSchema>;

export type SectionConfig =
  | { kind: "entity_results"; config: EntityResultsConfig }
  | { kind: "rich_text"; config: RichTextConfig }
  | { kind: "map"; config: MapConfig };

const firstIssue = (e: z.ZodError) => {
  const i = e.issues[0];
  return `${i.path.join(".") || "settings"}: ${i.message}`;
};

/** Validates + normalizes a V1B Section's stored config. Never throws; an
 * invalid config makes the Section render nothing (fail closed). */
export function parseSectionConfig(kind: PageSectionKind, raw: unknown): { ok: true; value: SectionConfig } | { ok: false; error: string } {
  if (kind === "entity_results") {
    const r = entityResultsConfigSchema.safeParse(raw);
    return r.success ? { ok: true, value: { kind, config: normalizeEntityConfig(r.data) } } : { ok: false, error: firstIssue(r.error) };
  }
  if (kind === "rich_text") {
    const r = richTextConfigSchema.safeParse(raw);
    return r.success ? { ok: true, value: { kind, config: r.data } } : { ok: false, error: firstIssue(r.error) };
  }
  const r = mapConfigSchema.safeParse(raw);
  return r.success ? { ok: true, value: { kind, config: r.data } } : { ok: false, error: firstIssue(r.error) };
}

/** Keeps only what the scope can answer: filters the scope supports,
 * references of the scope's kinds, de-duplicated. An excluded entity is
 * never also pinned or included (exclusion wins). Date precedence: a
 * single date beats a range, a range beats a named window. */
export function normalizeEntityConfig(c: EntityResultsConfig): EntityResultsConfig {
  const allowed = new Set(SCOPE_FILTERS[c.scope]);
  const filters: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c.filters)) {
    if (v === undefined || !allowed.has(k)) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    filters[k] = Array.isArray(v) ? [...new Set(v)] : v;
  }
  if (filters.date) {
    delete filters.from;
    delete filters.to;
    delete filters.when;
  } else if (filters.from || filters.to) delete filters.when;

  const kinds = new Set<EntityRefKind>(SCOPE_REF_KINDS[c.scope]);
  const clean = (list: EntityRef[], drop: Set<string> = new Set()) => {
    const seen = new Set<string>();
    return list.filter((r) => {
      const k = refKey(r);
      if (!kinds.has(r.kind) || seen.has(k) || drop.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  const excludes = clean(c.excludes);
  const excluded = new Set(excludes.map(refKey));
  const pins = clean(c.pins, excluded);
  const pinned = new Set(pins.map(refKey));
  const includes = clean(c.includes, new Set([...excluded, ...pinned]));
  return { ...c, filters: filters as ResultFilters, includes, excludes, pins };
}

export function defaultEntityConfig(scope: EntityScope): EntityResultsConfig {
  return { scope, mode: "dynamic", filters: scope === "events" ? { when: "upcoming" } : {}, includes: [], excludes: [], pins: [], limit: 12, layout: "carousel" };
}

// ------------------------------------------------------------ composition

export type ResultOrigin = "pinned" | "included" | "auto";

/** The one composition rule for Manual / Dynamic / Hybrid:
 *   manual  → the included entities, in their saved order;
 *   dynamic → the query's results;
 *   hybrid  → pins first (in order), then includes, then the query fills.
 * Excluded entities never appear (in any mode); an entity appears once;
 * unresolvable references (deleted / unpublished) drop out; the limit
 * applies last. `resolved` maps refKey → the entity for pins/includes. */
export function composeEntityResults<T>(input: {
  mode: EntityResultsConfig["mode"];
  pins: readonly EntityRef[];
  includes: readonly EntityRef[];
  excludes: readonly EntityRef[];
  resolved: ReadonlyMap<string, T>;
  dynamic: readonly { key: string; item: T }[];
  limit: number;
}): { key: string; item: T; origin: ResultOrigin }[] {
  const excluded = new Set(input.excludes.map(refKey));
  const out: { key: string; item: T; origin: ResultOrigin }[] = [];
  const seen = new Set<string>();
  const push = (key: string, item: T | undefined, origin: ResultOrigin) => {
    if (item === undefined || excluded.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push({ key, item, origin });
  };
  if (input.mode === "hybrid") for (const r of input.pins) push(refKey(r), input.resolved.get(refKey(r)), "pinned");
  if (input.mode !== "dynamic") for (const r of input.includes) push(refKey(r), input.resolved.get(refKey(r)), "included");
  if (input.mode !== "manual") for (const d of input.dynamic) push(d.key, d.item, "auto");
  return out.slice(0, input.limit);
}

/** References that need fetching by id for this mode. */
export function manualRefs(c: Pick<EntityResultsConfig, "mode" | "pins" | "includes">): EntityRef[] {
  if (c.mode === "dynamic") return [];
  return c.mode === "hybrid" ? [...c.pins, ...c.includes] : [...c.includes];
}

// ------------------------------------------------------------ Text & Editorial

export type RichSpan = { text: string; href?: string };
export type RichBlock = { type: "p"; spans: RichSpan[] } | { type: "ul"; items: RichSpan[][] } | { type: "h3"; text: string };

const LINK = /\[([^\]\n]{1,120})\]\(([^)\s]{1,2048})\)/g;

/** One line of text → spans. A [label](destination) link becomes a link
 * only when the destination passes the same validation every Findmi
 * custom link uses (https:// or a public /path); otherwise its label is
 * kept as plain text. Nothing else is interpreted — no HTML, ever. */
export function parseSpans(line: string): RichSpan[] {
  const out: RichSpan[] = [];
  let last = 0;
  for (const m of line.matchAll(LINK)) {
    if (m.index! > last) out.push({ text: line.slice(last, m.index) });
    const dest = validateCustomDestination(m[2]);
    out.push(dest.ok ? { text: m[1], href: dest.value } : { text: m[1] });
    last = m.index! + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last) });
  // Merge adjacent plain spans.
  return out.reduce<RichSpan[]>((acc, s) => {
    const prev = acc[acc.length - 1];
    if (prev && !prev.href && !s.href) prev.text += s.text;
    else acc.push({ ...s });
    return acc;
  }, []);
}

/** Body text → blocks. Blank lines separate paragraphs; consecutive lines
 * starting with "- " form a bullet list; a line starting with "### " is a
 * small subheading. Single line breaks inside a paragraph are kept. */
export function parseRichText(body: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  const chunks = body.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  for (const chunk of chunks) {
    const lines = chunk.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
    let para: string[] = [];
    let list: RichSpan[][] = [];
    const flushPara = () => {
      if (para.length) blocks.push({ type: "p", spans: parseSpans(para.join("\n")) });
      para = [];
    };
    const flushList = () => {
      if (list.length) blocks.push({ type: "ul", items: list });
      list = [];
    };
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith("### ")) {
        flushPara();
        flushList();
        blocks.push({ type: "h3", text: t.slice(4).trim() });
      } else if (/^[-•]\s+/.test(t)) {
        flushPara();
        list.push(parseSpans(t.replace(/^[-•]\s+/, "")));
      } else {
        flushList();
        para.push(t);
      }
    }
    flushPara();
    flushList();
  }
  return blocks;
}

// ------------------------------------------------------------ Admin summaries

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const md = (d: string) => `${MONTHS[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}`;

/** "Oct 26", "Oct 26 – Nov 2", "From Oct 26", "This Weekend" — or null. */
export function describeWhen(f: ResultFilters): string | null {
  if (f.date) return md(f.date);
  if (f.from && f.to) return f.from === f.to ? md(f.from) : `${md(f.from)} – ${md(f.to)}`;
  if (f.from) return `From ${md(f.from)}`;
  if (f.to) return `Through ${md(f.to)}`;
  return f.when ? WHEN_LABELS[f.when] : null;
}

/** The two summary lines a collapsed Section card shows:
 *   "Events & Appearances · Hybrid · 18 results"
 *   "NYC · Oct 26 – Nov 2 · 2 pinned · 1 excluded" */
export function summarizeEntitySection(c: EntityResultsConfig, opts: { count?: number | null; place?: string | null } = {}): { primary: string; secondary: string | null } {
  const count = opts.count == null ? null : `${opts.count} ${opts.count === 1 ? "result" : "results"}`;
  const primary = [ENTITY_SCOPE_LABELS[c.scope], ENTITY_MODE_LABELS[c.mode], count].filter(Boolean).join(" · ");
  const parts = [opts.place ?? null, c.mode === "manual" ? null : describeWhen(c.filters)];
  if (c.mode !== "dynamic" && c.includes.length) parts.push(`${c.includes.length} picked`);
  if (c.mode === "hybrid" && c.pins.length) parts.push(`${c.pins.length} pinned`);
  if (c.mode !== "manual" && c.excludes.length) parts.push(`${c.excludes.length} excluded`);
  const secondary = parts.filter(Boolean).join(" · ");
  return { primary, secondary: secondary || null };
}

export const SECTION_KIND_LABELS: Record<PageSectionKind | "feed" | "group", string> = {
  entity_results: "Results",
  rich_text: "Text & Editorial",
  map: "Map",
  feed: "Feed (Legacy)",
  group: "Group",
};

// ------------------------------------------------------------ Admin form input

type FormLike = { get(name: string): FormDataEntryValue | null; getAll(name: string): FormDataEntryValue[] };
const text = (f: FormLike, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};
const list = (f: FormLike, k: string) => [...new Set(f.getAll(k).map(String).map((v) => v.trim()).filter(Boolean))];
const refs = (f: FormLike, k: string): EntityRef[] =>
  list(f, k).flatMap((v) => {
    const [kind, id] = v.split(":");
    return (ENTITY_REF_KINDS as readonly string[]).includes(kind) && id ? [{ kind: kind as EntityRefKind, id }] : [];
  });

/** An Entity Results Section's Admin form → a config candidate (validate
 * with parseSectionConfig). Scope is fixed when the Section is created. */
export function entityConfigFromForm(scope: EntityScope, f: FormLike): unknown {
  const flags = new Set(list(f, "flag"));
  const filters: Record<string, unknown> = {
    when: text(f, "when"),
    date: text(f, "date"),
    from: text(f, "from"),
    to: text(f, "to"),
    categories: list(f, "category"),
    formats: list(f, "format"),
    text: text(f, "text"),
    brands: list(f, "brand"),
    places: list(f, "place"),
  };
  for (const k of ["free", "family", "rsvp", "tickets", "featured", "endingSoon", "justAnnounced"]) if (flags.has(k)) filters[k] = true;
  for (const [k, v] of Object.entries(filters)) if (v === undefined || (Array.isArray(v) && v.length === 0)) delete filters[k];
  const limit = Number(text(f, "limit") ?? 12);
  return {
    scope,
    mode: text(f, "mode") ?? "dynamic",
    filters,
    includes: refs(f, "include"),
    excludes: refs(f, "exclude"),
    pins: refs(f, "pin"),
    limit: Number.isFinite(limit) ? Math.round(limit) : 12,
    layout: text(f, "layout") === "grid" ? "grid" : "carousel",
  };
}

export function richTextConfigFromForm(f: FormLike): unknown {
  const out: Record<string, unknown> = { body: (typeof f.get("body") === "string" ? (f.get("body") as string) : "").replace(/\r\n?/g, "\n").trim() };
  for (const k of ["image_url", "image_alt", "cta_label", "cta_url"]) {
    const v = text(f, k);
    if (v) out[k] = v;
  }
  if (!out.image_url) delete out.image_alt;
  return out;
}

export function mapConfigFromForm(f: FormLike): unknown {
  return { sections: list(f, "map_section") };
}

/** One Preview Results action on a stored config: pin / unpin, exclude /
 * restore, include / remove. Returns the normalized config. */
export function applyRefAction(c: EntityResultsConfig, action: "pin" | "unpin" | "exclude" | "restore" | "include" | "remove", ref: EntityRef): EntityResultsConfig {
  const k = refKey(ref);
  const without = (l: EntityRef[]) => l.filter((r) => refKey(r) !== k);
  const next = { ...c, pins: without(c.pins), includes: without(c.includes), excludes: without(c.excludes) };
  if (action === "pin") next.pins = [...next.pins, ref];
  if (action === "include") next.includes = [...next.includes, ref];
  if (action === "exclude") next.excludes = [...next.excludes, ref];
  // Pins and includes don't show in Dynamic mode; adding one switches the
  // Section to Hybrid so it takes effect.
  if ((action === "pin" || action === "include") && next.mode === "dynamic") next.mode = "hybrid";
  return normalizeEntityConfig(entityResultsConfigSchema.parse(next));
}
