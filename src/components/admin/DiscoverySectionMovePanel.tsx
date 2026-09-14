import {
  moveSectionBottom,
  moveSectionDown,
  moveSectionTop,
  moveSectionUnderGroup,
  moveSectionUp,
  placeSectionAfter,
  placeSectionBefore,
  returnSectionToTopLevel,
  setSectionPosition,
} from "@/app/admin/(protected)/site/pages/actions";

const btn =
  "rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink/70 transition hover:bg-black/[0.03]";
const selectClass = "rounded-xl border border-black/10 bg-white px-2.5 py-2 text-sm text-ink focus:border-ink/30 focus:outline-none";

/** The Phase 1 mobile-first Move control — a plain <details> disclosure
 * (native, no JS required, no z-index/portal/overflow-clipping risk —
 * FindMi has already hit that exact bug class twice with client popovers,
 * see AccountNav's history) holding every deterministic move operation as
 * its own small form. Deliberately NOT a reuse of the public site's
 * FilterSheet — that component is public-facing and filter-shaped; this
 * is admin-only and move-shaped, so a dedicated, dependency-free panel
 * avoids coupling the two for a passing visual resemblance only. */
export default function DiscoverySectionMovePanel({
  id,
  pageId,
  isGroup,
  parentId,
  position,
  siblingCount,
  siblings,
  groups,
}: {
  id: string;
  pageId: string;
  isGroup: boolean;
  parentId: string | null;
  /** 1-indexed position among the row's CURRENT siblings. */
  position: number;
  siblingCount: number;
  /** The row's current siblings (same parent), excluding itself — targets
   * for Before/After. */
  siblings: { id: string; title: string }[];
  /** Every top-level Group section on the page, excluding this row if it
   * is one (a Group can never be nested — enforced by the DB trigger, not
   * re-enforced here beyond simply not offering the control). */
  groups: { id: string; title: string }[];
}) {
  return (
    <details className="mt-3 rounded-xl border border-black/10 bg-black/[0.015] p-3">
      <summary className="cursor-pointer select-none text-xs font-semibold text-ink">
        Move — position {position} of {siblingCount}
      </summary>

      <div className="mt-3 flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          <form action={moveSectionUp.bind(null, id, pageId)}>
            <button type="submit" className={btn} disabled={position <= 1}>
              ↑ Up
            </button>
          </form>
          <form action={moveSectionDown.bind(null, id, pageId)}>
            <button type="submit" className={btn} disabled={position >= siblingCount}>
              ↓ Down
            </button>
          </form>
          <form action={moveSectionTop.bind(null, id, pageId)}>
            <button type="submit" className={btn} disabled={position <= 1}>
              ⤒ Top
            </button>
          </form>
          <form action={moveSectionBottom.bind(null, id, pageId)}>
            <button type="submit" className={btn} disabled={position >= siblingCount}>
              ⤓ Bottom
            </button>
          </form>
        </div>

        {siblings.length > 0 && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <form action={placeSectionBefore.bind(null, id, pageId)} className="flex flex-1 gap-1.5">
              <select name="target_id" className={`flex-1 ${selectClass}`} defaultValue={siblings[0].id}>
                {siblings.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
              <button type="submit" className={btn}>
                Before
              </button>
            </form>
            <form action={placeSectionAfter.bind(null, id, pageId)} className="flex flex-1 gap-1.5">
              <select name="target_id" className={`flex-1 ${selectClass}`} defaultValue={siblings[0].id}>
                {siblings.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
              <button type="submit" className={btn}>
                After
              </button>
            </form>
          </div>
        )}

        <form action={setSectionPosition.bind(null, id, pageId)} className="flex items-center gap-2">
          <span className="text-xs font-medium text-ink/60">Position</span>
          <input
            type="number"
            name="position"
            min={1}
            max={siblingCount}
            defaultValue={position}
            className="w-16 rounded-xl border border-black/10 bg-white px-2.5 py-2 text-sm text-ink focus:border-ink/30 focus:outline-none"
          />
          <button type="submit" className={btn}>
            Set
          </button>
        </form>

        {!isGroup && groups.length > 0 && (
          <form action={moveSectionUnderGroup.bind(null, id, pageId)} className="flex gap-1.5">
            <select name="group_id" className={`flex-1 ${selectClass}`} defaultValue={groups[0].id}>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
            <button type="submit" className={btn}>
              Move Under Group
            </button>
          </form>
        )}

        {parentId && (
          <form action={returnSectionToTopLevel.bind(null, id, pageId)}>
            <button type="submit" className={btn}>
              Return to Top Level
            </button>
          </form>
        )}
      </div>
    </details>
  );
}
