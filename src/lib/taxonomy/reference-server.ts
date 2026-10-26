import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import type { LegacyMappingRow, TopicRef, V2CategoryRef } from "./compat-policy";
import type { TaxonomyEntityType, TermVocabulary, V2CategoryKind } from "./v2";
import type { LegacyKind, MappingTarget } from "./v2-legacy";

// Taxonomy V2 — Pass 3B: the reference data every compatibility read needs
// (server-only). Read with the service-role client because the V2 tables are
// server-only and the V2 tree includes STAGED categories, which RLS hides from
// anon/authenticated. Nothing here changes RLS or grants, and nothing loaded
// here is ever handed to a V1 selector: staged status travels with every V2
// Category (V2CategoryRef.status), and only publicCategoryLabel() may turn one
// into public text.
//
// Two hierarchies stay separate: V1 categories.parent_id (read by V1
// surfaces, untouched) and the V2 tree in category_tree_v2 (used here).
// Small, bounded tables (~1,100 rows in total), loaded once per request.

export interface V1CategoryRow {
  id: string;
  kind: LegacyKind | "event_format";
  slug: string;
  status: string;
}

export interface TermRef {
  id: string;
  vocabulary: TermVocabulary;
  slug: string;
  name: string;
  status: string;
}

interface TopicRow extends TopicRef {
  appliesTo: readonly string[];
  status: string;
}

export interface TaxonomyReference {
  /** Any categories row by id (V1 identity: kind + slug), staged included. */
  v1Category(id: string): V1CategoryRow | undefined;
  /** A V2 tree member by id; undefined if the row is not in the V2 tree. */
  category(id: string): V2CategoryRef | undefined;
  categoryBySlug(kind: V2CategoryKind, slug: string): V2CategoryRef | undefined;
  categories(kind?: V2CategoryKind): V2CategoryRef[];
  /** The V2 Category plus every V2 descendant (for "parent includes
   * children" matching). */
  withDescendants(categoryId: string): string[];
  term(id: string): TermRef | undefined;
  termBySlug(vocabulary: TermVocabulary, slug: string): TermRef | undefined;
  /** Active Topics only; a draft or retired Topic never classifies. */
  topic(id: string): TopicRef | undefined;
  topicBySlug(slug: string): TopicRef | undefined;
  topics(): TopicRef[];
  topicAppliesTo(topicId: string, entity: TaxonomyEntityType): boolean;
  /** Topics a Category implies: declared on the Category itself or on any
   * of its V2 ancestors. */
  impliedTopics(categoryId: string): { topicId: string; viaCategoryId: string }[];
  mapping(kind: LegacyKind, slug: string): LegacyMappingRow | undefined;
}

type Row = Record<string, unknown>;
const PAGE = 1000;

async function selectAll(client: SupabaseClient, table: string, cols: string, apply?: (q: any) => any): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = client.from(table).select(cols);
    if (apply) q = apply(q);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`taxonomy reference: ${table}: ${error.message}`);
    const rows = (data ?? []) as unknown as Row[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function buildTaxonomyReference(client: SupabaseClient): Promise<TaxonomyReference> {
  const [cats, tree, terms, topics, catTopics, mappings] = await Promise.all([
    selectAll(client, "categories", "id, kind, slug, name, status"),
    selectAll(client, "category_tree_v2", "category_id, kind, parent_category_id, depth, display_name, sort_order"),
    selectAll(client, "taxonomy_terms", "id, vocabulary, slug, name, status"),
    selectAll(client, "topics", "id, slug, name, kind, broader_topic_id, applies_to, status"),
    selectAll(client, "category_topics", "category_id, topic_id"),
    selectAll(client, "taxonomy_legacy_mappings", "legacy_source, legacy_kind, legacy_slug, targets, mapping_confidence, status", (q) => q.eq("legacy_source", "category")),
  ]);

  const catRow = new Map(cats.map((c) => [str(c.id), c]));
  const v1 = new Map<string, V1CategoryRow>();
  for (const c of cats) v1.set(str(c.id), { id: str(c.id), kind: str(c.kind) as V1CategoryRow["kind"], slug: str(c.slug), status: str(c.status) });

  const parentOf = new Map<string, string | null>();
  for (const t of tree) parentOf.set(str(t.category_id), (t.parent_category_id as string | null) ?? null);
  const ancestors = (id: string): string[] => {
    const out: string[] = [];
    for (let p = parentOf.get(id) ?? null; p && !out.includes(p) && out.length < 8; p = parentOf.get(p) ?? null) out.push(p);
    return out;
  };
  const nodes = new Map<string, V2CategoryRef>();
  const bySlug = new Map<string, V2CategoryRef>();
  const children = new Map<string, string[]>();
  for (const t of [...tree].sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))) {
    const id = str(t.category_id);
    const row = catRow.get(id);
    if (!row) continue;
    const node: V2CategoryRef = {
      id,
      kind: str(t.kind) as V2CategoryKind,
      slug: str(row.slug),
      label: (typeof t.display_name === "string" && t.display_name) || str(row.name),
      status: row.status === "staged" ? "staged" : "active",
      depth: Number(t.depth ?? 1),
      parentId: parentOf.get(id) ?? null,
      ancestorIds: ancestors(id),
    };
    nodes.set(id, node);
    bySlug.set(`${node.kind}:${node.slug}`, node);
    if (node.parentId) children.set(node.parentId, [...(children.get(node.parentId) ?? []), id]);
  }

  const termById = new Map<string, TermRef>();
  const termBySlug = new Map<string, TermRef>();
  for (const t of terms) {
    const ref: TermRef = { id: str(t.id), vocabulary: str(t.vocabulary) as TermVocabulary, slug: str(t.slug), name: str(t.name), status: str(t.status) };
    termById.set(ref.id, ref);
    termBySlug.set(`${ref.vocabulary}:${ref.slug}`, ref);
  }

  const topicById = new Map<string, TopicRow>();
  for (const t of topics) {
    if (t.status !== "active") continue;
    topicById.set(str(t.id), {
      id: str(t.id),
      slug: str(t.slug),
      name: str(t.name),
      kind: t.kind === "occasion" ? "occasion" : "subject",
      broaderTopicId: (t.broader_topic_id as string | null) ?? null,
      appliesTo: Array.isArray(t.applies_to) ? (t.applies_to as string[]) : [],
      status: str(t.status),
    });
  }
  const topicBySlug = new Map([...topicById.values()].map((t) => [t.slug, t]));
  const declared = new Map<string, string[]>();
  for (const ct of catTopics) declared.set(str(ct.category_id), [...(declared.get(str(ct.category_id)) ?? []), str(ct.topic_id)]);

  const mappingByKey = new Map<string, LegacyMappingRow>();
  for (const m of mappings) {
    const row: LegacyMappingRow = {
      legacyKind: str(m.legacy_kind) as LegacyKind,
      legacySlug: str(m.legacy_slug),
      targets: (Array.isArray(m.targets) ? m.targets : []) as MappingTarget[],
      mappingConfidence: (m.mapping_confidence as LegacyMappingRow["mappingConfidence"]) ?? null,
      status: (str(m.status) || "draft") as LegacyMappingRow["status"],
    };
    mappingByKey.set(`${row.legacyKind}:${row.legacySlug}`, row);
  }

  const toTopicRef = (t: TopicRow | undefined): TopicRef | undefined =>
    t && { id: t.id, slug: t.slug, name: t.name, kind: t.kind, broaderTopicId: t.broaderTopicId };

  return {
    v1Category: (id) => v1.get(id),
    category: (id) => nodes.get(id),
    categoryBySlug: (kind, slug) => bySlug.get(`${kind}:${slug}`),
    categories: (kind) => [...nodes.values()].filter((n) => !kind || n.kind === kind),
    withDescendants(id) {
      const out = [id];
      for (let i = 0; i < out.length; i++) for (const c of children.get(out[i]) ?? []) if (!out.includes(c)) out.push(c);
      return out;
    },
    term: (id) => termById.get(id),
    termBySlug: (vocabulary, slug) => termBySlug.get(`${vocabulary}:${slug}`),
    topic: (id) => toTopicRef(topicById.get(id)),
    topicBySlug: (slug) => toTopicRef(topicBySlug.get(slug)),
    topics: () => [...topicById.values()].map((t) => toTopicRef(t)!),
    topicAppliesTo: (id, entity) => Boolean(topicById.get(id)?.appliesTo.includes(entity)),
    impliedTopics(categoryId) {
      const node = nodes.get(categoryId);
      if (!node) return [];
      return [categoryId, ...node.ancestorIds].flatMap((via) => (declared.get(via) ?? []).filter((t) => topicById.has(t)).map((topicId) => ({ topicId, viaCategoryId: via })));
    },
    mapping: (kind, slug) => mappingByKey.get(`${kind}:${slug}`),
  };
}

/** Request-level cached reference, via the service-role client. Throws when
 * the server has no service-role configuration (internal infrastructure —
 * callers decide how to degrade). */
export const loadTaxonomyReference = cache(async (): Promise<TaxonomyReference> => {
  const client = getAdminSupabase();
  if (!client) throw new Error("taxonomy reference: service-role client unavailable");
  return buildTaxonomyReference(client);
});
