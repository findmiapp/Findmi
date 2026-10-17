// Discovery Intelligence V1 — Personal relationships: explicit, user-set
// statements about an entity ("Must Do", "Been", "Want", "Have", "Like").
// Never inferred, never sensitive. Saves/Follows stay in their existing
// account_* tables. Pure (client + server). Mirrors the CHECKs on
// user_entity_relationships in 20261024000000_discovery_intelligence_v1.sql.

export const RELATIONSHIP_ENTITY_TYPES = ["event", "business", "location", "product", "topic", "area"] as const;
export type RelationshipEntityType = (typeof RELATIONSHIP_ENTITY_TYPES)[number];
export const RELATIONSHIPS = ["want", "must_do", "like", "dislike", "been", "have"] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

/** Which statements make sense for which entity. */
export const ALLOWED_RELATIONSHIPS: Record<RelationshipEntityType, readonly Relationship[]> = {
  event: ["must_do", "been", "like", "dislike"],
  location: ["must_do", "been", "like", "dislike"],
  business: ["like", "dislike"],
  product: ["want", "have"],
  topic: ["like", "dislike"],
  area: ["like", "dislike"],
};

/** Setting one of these clears the other (you can't both Like and
 * Dislike something). */
export const EXCLUSIVE: Partial<Record<Relationship, Relationship>> = { like: "dislike", dislike: "like" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateRelationship(input: { entityType?: unknown; entityId?: unknown; relation?: unknown }): { ok: true; entityType: RelationshipEntityType; entityId: string; relation: Relationship } | { ok: false; error: string } {
  const { entityType, entityId, relation } = input;
  if (typeof entityType !== "string" || !(RELATIONSHIP_ENTITY_TYPES as readonly string[]).includes(entityType)) return { ok: false, error: "Unknown entity type." };
  if (typeof entityId !== "string" || !UUID.test(entityId)) return { ok: false, error: "Malformed identifier." };
  if (typeof relation !== "string" || !ALLOWED_RELATIONSHIPS[entityType as RelationshipEntityType].includes(relation as Relationship)) return { ok: false, error: "That isn't available for this." };
  return { ok: true, entityType: entityType as RelationshipEntityType, entityId, relation: relation as Relationship };
}
