// Moments — one creator-controlled photo order per Moment. The global
// sequence (journal_entry_media.display_order) is authoritative; a photo's
// section is independent metadata. These pure helpers are the only order
// rules the editor uses: section changes keep every photo in place, Move
// Earlier/Later steps across the whole sequence, and a section filter is a
// view that keeps relative global order and can never rewrite it.

/** "all" = the unfiltered, authoritative sequence. */
export type MomentSectionFilter = "all" | string;

type Ordered = { localId: string; sectionId?: string | null };

/** Sets (or clears, with null) the section of the given photos IN PLACE. */
export function assignSectionInPlace<T extends Ordered>(items: T[], localIds: Iterable<string>, sectionId: string | null): T[] {
  const ids = new Set(localIds);
  if (!items.some((it) => ids.has(it.localId) && (it.sectionId ?? null) !== sectionId)) return items;
  return items.map((it) => (ids.has(it.localId) ? { ...it, sectionId } : it));
}

/** Swaps a photo with its neighbour in the global sequence. */
export function moveAdjacent<T extends Ordered>(items: T[], localId: string, direction: -1 | 1): T[] {
  const index = items.findIndex((it) => it.localId === localId);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** The photos a section filter shows, in global order. Never reorders. */
export function filterBySection<T extends Ordered>(items: T[], filter: MomentSectionFilter): T[] {
  return filter === "all" ? items : items.filter((it) => (it.sectionId ?? null) === filter);
}

/** Reordering is authoritative only from All. */
export function canReorder(filter: MomentSectionFilter): boolean {
  return filter === "all";
}

type LayoutRow = { id: string; display_order: number; section_id: string | null };

/** The server's layout plan: the row patches a save writes. display_order
 * comes ONLY from an explicit photo order (named photos first, the rest
 * after in their stored order); section assignments only ever patch
 * section_id. Without a photo order nothing is renumbered. */
export function planMediaLayout(
  media: LayoutRow[],
  opts: { mediaOrder?: string[]; assignments?: Map<string, string | null> }
): { id: string; patch: { display_order?: number; section_id?: string | null } }[] {
  const byId = new Map(media.map((m) => [m.id, m]));
  const named = [...new Set((opts.mediaOrder ?? []).filter((id) => byId.has(id)))];
  const namedSet = new Set(named);
  const sequence = [...named.map((id) => byId.get(id)!), ...media.filter((m) => !namedSet.has(m.id))];
  const writeOrder = opts.mediaOrder !== undefined;
  return sequence.flatMap((m, index) => {
    const patch: { display_order?: number; section_id?: string | null } = {};
    if (writeOrder && m.display_order !== index) patch.display_order = index;
    if (opts.assignments?.has(m.id) && opts.assignments.get(m.id) !== m.section_id) patch.section_id = opts.assignments.get(m.id)!;
    return Object.keys(patch).length === 0 ? [] : [{ id: m.id, patch }];
  });
}
