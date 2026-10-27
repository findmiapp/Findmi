// Business schedule → map: why a date can't be drawn on the Business's map
// (pure). The public schedule map (lib/geo-results-server scheduleResults)
// draws a date only at its own canonical Location with real coordinates —
// never an approximate or invented point — so a date that fails here is
// missing from the map. Business Manager shows the reason on the row, so
// the gap is actionable (link / fix the place) instead of silent.
import { isValidCoordinate } from "./discovery/map-core";

export type ScheduleMapGap = "no_location" | "no_coordinates" | null;

export function scheduleMapGap(row: {
  location: { latitude?: number | null; longitude?: number | null } | null;
  location_hidden?: boolean | null;
}): ScheduleMapGap {
  if (row.location_hidden) return null; // withheld on purpose — not a gap
  if (!row.location) return "no_location";
  return isValidCoordinate(row.location.latitude, row.location.longitude) ? null : "no_coordinates";
}

export const SCHEDULE_MAP_GAP_LABEL: Record<Exclude<ScheduleMapGap, null>, string> = {
  no_location: "Not on your map — link a Findmi place",
  no_coordinates: "Not on your map — this place has no map position yet",
};
