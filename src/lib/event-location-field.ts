// Event "Where" field — state rules (pure; shared by EventLocationField and
// its tests). Findmi Place first, manual venue second:
//
//   - a selected Findmi Place is the canonical Location: its id is what the
//     form submits (the server re-reads the Location's own address — the
//     submitted text is display only), and no manual text is submitted;
//   - manual venue fields appear only when the creator chooses
//     "Add Venue Details Manually" (or the Event already has manual venue
//     text and no Location);
//   - changing / clearing the Place, switching to manual, or cancelling
//     manual entry never leaves a stale Location id or stale venue text in
//     what the form submits.

export interface PlaceSelection {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
}

export interface ManualVenue {
  venue_name: string;
  address: string;
  city: string;
  state: string;
  postal_code: string;
}

export const EMPTY_MANUAL_VENUE: ManualVenue = { venue_name: "", address: "", city: "", state: "", postal_code: "" };

export interface WhereFieldState<P extends PlaceSelection = PlaceSelection> {
  selected: P | null;
  manual: ManualVenue;
  manualOpen: boolean;
}

const hasText = (m: ManualVenue | null | undefined) => Boolean(m && (m.venue_name || m.address || m.city || m.state || m.postal_code));

/** Editing restores what the Event really has: its canonical Place when it
 * has one; otherwise its manual venue text (shown open); otherwise an empty
 * Place search with manual entry collapsed. */
export function initialWhereState<P extends PlaceSelection>(initialPlace: P | null, initialManual: ManualVenue | null): WhereFieldState<P> {
  if (initialPlace) return { selected: initialPlace, manual: { ...EMPTY_MANUAL_VENUE }, manualOpen: false };
  return { selected: null, manual: { ...EMPTY_MANUAL_VENUE, ...(initialManual ?? {}) }, manualOpen: hasText(initialManual) };
}

/** Pick (or change to) a Findmi Place — manual entry closes and clears. */
export function selectPlace<P extends PlaceSelection>(_state: WhereFieldState<P>, place: P): WhereFieldState<P> {
  return { selected: place, manual: { ...EMPTY_MANUAL_VENUE }, manualOpen: false };
}

/** Clear the Place to search for a different one. */
export function clearPlace<P extends PlaceSelection>(_state: WhereFieldState<P>): WhereFieldState<P> {
  return { selected: null, manual: { ...EMPTY_MANUAL_VENUE }, manualOpen: false };
}

/** Switch to manual venue entry — the Place (and its id) is dropped. */
export function openManualVenue<P extends PlaceSelection>(state: WhereFieldState<P>): WhereFieldState<P> {
  return { selected: null, manual: state.selected ? { ...EMPTY_MANUAL_VENUE } : state.manual, manualOpen: true };
}

/** Close manual entry without keeping what was typed. */
export function cancelManualVenue<P extends PlaceSelection>(_state: WhereFieldState<P>): WhereFieldState<P> {
  return { selected: null, manual: { ...EMPTY_MANUAL_VENUE }, manualOpen: false };
}

/** Exactly what the form submits (hidden inputs). */
export function whereSubmission(state: WhereFieldState): {
  location_id: string;
  venue_name: string;
  address: string;
  city: string;
  state: string;
  postal_code: string;
} {
  if (state.selected) {
    const p = state.selected;
    return { location_id: p.id, venue_name: p.name, address: p.address ?? "", city: p.city ?? "", state: p.state ?? "", postal_code: p.postal_code ?? "" };
  }
  const m = state.manualOpen ? state.manual : EMPTY_MANUAL_VENUE;
  return { location_id: "", venue_name: m.venue_name, address: m.address, city: m.city, state: m.state, postal_code: m.postal_code };
}
