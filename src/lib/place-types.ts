// Physical Presence Pass 2 — Location Hierarchy V1. The structural
// place_type vocabulary for `locations.place_type` (mirrors the
// locations_place_type_check constraint in
// 20261003010000_location_place_hierarchy.sql — keep both in sync). Pure
// and isomorphic: safe for Server Actions and client/server components.
//
// place_type describes WHAT KIND OF PHYSICAL NODE a place is (a kiosk, a
// floor, a park). It is not the Location category system (cuisine,
// shopping, etc.) and never encodes a commercial relationship.

export const PLACE_TYPES = [
  "district",
  "complex",
  "campus",
  "mall",
  "building",
  "park",
  "plaza",
  "floor",
  "venue",
  "store",
  "restaurant",
  "kiosk",
  "activation_space",
  "landmark",
] as const;

export type LocationPlaceType = (typeof PLACE_TYPES)[number];

export const PLACE_TYPE_LABELS: Record<LocationPlaceType, string> = {
  district: "District",
  complex: "Complex",
  campus: "Campus",
  mall: "Mall",
  building: "Building",
  park: "Park",
  plaza: "Plaza",
  floor: "Floor",
  venue: "Venue",
  store: "Store",
  restaurant: "Restaurant",
  kiosk: "Kiosk",
  activation_space: "Activation Space",
  landmark: "Landmark",
};

export function isPlaceType(value: string | null | undefined): value is LocationPlaceType {
  return Boolean(value) && (PLACE_TYPES as readonly string[]).includes(value as string);
}
