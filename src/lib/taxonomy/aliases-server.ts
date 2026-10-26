import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { normalizeSearch } from "@/lib/geo/census-format";
import { publicCategoryLabel } from "./compat-policy";
import { loadTaxonomyReference, type TaxonomyReference } from "./reference-server";
import { normalizeAliasPhrase, type AliasDimension, type TermVocabulary } from "./v2";

// Taxonomy V2 — Pass 3B: alias resolution infrastructure (server-only).
//
// Returns EVERY reading of a phrase — V2 taxonomy_aliases rows and, separately,
// the V1 Discovery Topics the phrase already means in /search and /map — and
// never chooses between them. Many phrases have several readings today ("pop
// up" is a Mechanic, an Appearance Type AND the V1 "Pop-Ups" Discovery Topic;
// "market", "samples", "kids" likewise), and two V2 Topic slugs equal V1
// Discovery Topic slugs ("beauty", "fashion"). The current parser and the
// `?topic=` URL keep their V1 meaning; this is not wired into either.

export interface AliasCandidate {
  phrase: string;
  dimension: AliasDimension;
  /** target_id dimensions (Categories, terms, Topics, Areas, Regions). */
  targetId: string | null;
  /** target_code dimensions (audience, entry_mode, benefit, …). */
  targetCode: string | null;
  /** Slug of the target when the reference knows it. */
  targetSlug: string | null;
  /** Internal label (never render a staged Category's label publicly). */
  label: string | null;
  /** Safe public label: null for a staged Category or an unknown target. */
  publicLabel: string | null;
  /** Entity types the reading applies to (null = any). */
  scope: string[] | null;
  priority: number;
  source: string;
}

export interface V1DiscoveryTopicMatch {
  slug: string;
  name: string;
}

export interface AliasResolution {
  phrase: string;
  /** Sorted by priority (desc), then dimension — order is presentation
   * only, never a decision. */
  candidates: AliasCandidate[];
  /** V1 Discovery Topics whose name, slug or alias equals the phrase. */
  discoveryTopics: V1DiscoveryTopicMatch[];
  /** V2 Topics whose slug equals a matched V1 Discovery Topic slug. */
  topicSlugCollisions: string[];
  /** More than one reading in total — the caller must not pick silently. */
  ambiguous: boolean;
}

const TERM_DIMENSIONS: readonly string[] = ["event_type", "experience_mechanic", "appearance_type", "opportunity_category"];

function describe(ref: TaxonomyReference, dimension: string, id: string | null): { slug: string | null; label: string | null; publicLabel: string | null } {
  if (!id) return { slug: null, label: null, publicLabel: null };
  if (dimension === "category") {
    const c = ref.category(id);
    return { slug: c?.slug ?? null, label: c?.label ?? null, publicLabel: publicCategoryLabel(c) };
  }
  if (dimension === "topic") {
    const t = ref.topic(id);
    return { slug: t?.slug ?? null, label: t?.name ?? null, publicLabel: t?.name ?? null };
  }
  if (TERM_DIMENSIONS.includes(dimension)) {
    const t = ref.term(id);
    const visible = t && t.vocabulary === (dimension as TermVocabulary) && t.status === "active";
    return { slug: t?.slug ?? null, label: t?.name ?? null, publicLabel: visible ? t.name : null };
  }
  return { slug: null, label: null, publicLabel: null };
}

/** All readings of each phrase (batched: one alias read, one Discovery
 * Topic read). */
export async function resolveTaxonomyAliases(phrases: readonly string[], opts: { client?: SupabaseClient; reference?: TaxonomyReference } = {}): Promise<Map<string, AliasResolution>> {
  const normalized = [...new Set(phrases.map(normalizeAliasPhrase).filter(Boolean))];
  const out = new Map<string, AliasResolution>();
  if (normalized.length === 0) return out;
  const client = opts.client ?? getAdminSupabase();
  if (!client) throw new Error("taxonomy aliases: service-role client unavailable");
  const ref = opts.reference ?? (await loadTaxonomyReference());
  const [aliasesRes, topicsRes] = await Promise.all([
    client.from("taxonomy_aliases").select("phrase, dimension, target_id, target_code, entity_types, priority, source").eq("status", "active").in("phrase", normalized),
    client.from("discovery_topics").select("slug, name, aliases").eq("is_active", true),
  ]);
  if (aliasesRes.error) throw new Error(`taxonomy aliases: ${aliasesRes.error.message}`);
  if (topicsRes.error) throw new Error(`taxonomy aliases: discovery_topics: ${topicsRes.error.message}`);
  const aliases = (aliasesRes.data ?? []) as unknown as Record<string, unknown>[];
  const dts = (topicsRes.data ?? []) as unknown as { slug: string; name: string; aliases: string[] | null }[];

  for (const phrase of normalized) {
    const candidates: AliasCandidate[] = aliases
      .filter((a) => a.phrase === phrase)
      .map((a) => {
        const targetId = typeof a.target_id === "string" ? a.target_id : null;
        const d = describe(ref, String(a.dimension), targetId);
        return {
          phrase,
          dimension: a.dimension as AliasDimension,
          targetId,
          targetCode: typeof a.target_code === "string" ? a.target_code : null,
          targetSlug: d.slug,
          label: d.label,
          publicLabel: d.publicLabel,
          scope: Array.isArray(a.entity_types) ? (a.entity_types as string[]) : null,
          priority: typeof a.priority === "number" ? a.priority : 0,
          source: String(a.source ?? ""),
        };
      })
      .sort((x, y) => y.priority - x.priority || x.dimension.localeCompare(y.dimension));
    const key = normalizeSearch(phrase);
    const discoveryTopics = dts
      .filter((t) => [t.name, t.slug.replace(/-/g, " "), ...(t.aliases ?? [])].some((n) => normalizeSearch(n) === key))
      .map((t) => ({ slug: t.slug, name: t.name }));
    const topicSlugCollisions = discoveryTopics.map((t) => t.slug).filter((s) => ref.topicBySlug(s));
    out.set(phrase, { phrase, candidates, discoveryTopics, topicSlugCollisions, ambiguous: candidates.length + discoveryTopics.length > 1 });
  }
  return out;
}
