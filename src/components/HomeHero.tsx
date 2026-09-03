import SupabaseImage from "./SupabaseImage";
import Link from "next/link";

// The homepage's masthead.
//
// Mobile geometry, several passes in: below sm:, copy (headline + body
// only — the CTA now lives BELOW the collage, not between body and it)
// sits in normal flow at the top, and the 3-image collage is a
// normal-flow block that starts right after body — its start position is
// always correct for whatever body actually renders as, never an
// estimate. Image 2 additionally reaches up above the collage's own top,
// into the open space beside body's lower rows, which is safe because
// it's confined to the right side clear of body's own width cap. See the
// mobile branch below for the exact numbers.
// From sm: up, this file renders the UNCHANGED existing desktop
// markup (own flex-row, own collage box) — the two are simply two
// sibling branches (`sm:hidden` / `hidden sm:flex`) rather than one
// shared responsive layout, because the mobile canvas's positioning
// model genuinely doesn't translate to desktop's copy-left/collage-right
// row, and this pass is mobile-only per its own brief.
//
// `images` are real cover photos already fetched for other homepage
// sections (featured businesses / the live appearances feed) — never
// stock/decorative photography, never fabricated: with fewer than 3
// available, this renders however many real ones there are, and with
// zero it renders no collage at all.
//
// Geometry changed; editability didn't — heading/body/CTA and all three
// image slots are still the same founder-editable Site Editor fields
// (Hero → Heading/Body/Image 1-3).
const DEFAULT_HEADING_LINES = ["Find what's", "around you.", "Get discovered."];

export default function HomeHero({
  images,
  heading,
  description,
}: {
  images: string[];
  /** Founder-editable via Site Editor → Hero → Heading (Discovery/
   * Archive V2 Part 18) — newlines control the visual lines, same as
   * closing_cta's heading already does elsewhere on this page. Rendered
   * as plain React text (never dangerouslySetInnerHTML), so raw HTML in
   * a founder's input is never interpreted, only ever displayed as
   * literal text. */
  heading: string | null;
  description: string | null;
}) {
  const [a, b, c] = images;
  // Real lines only, capped at 3 — the hero's compact height (and the
  // last-line accent treatment below) is designed around exactly that
  // many; extra lines are silently dropped rather than blowing up the
  // masthead or erroring on unexpected founder input.
  const lines = (heading?.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 3) ?? []);
  const headingLines = lines.length > 0 ? lines : DEFAULT_HEADING_LINES;
  const lastIndex = headingLines.length - 1;

  const headingContent = headingLines.map((line, i) => (
    <span key={i}>
      {i === lastIndex ? <span className="whitespace-nowrap text-findmi-600">{line}</span> : line}
      {i < lastIndex && <br />}
    </span>
  ));

  return (
    <section className="border-b border-black/5 bg-white">
      <div className="mx-auto max-w-6xl">
        {/* ================= MOBILE (<640px) — collage rises, CTA moves below ================
            Text block is now Headline + Body ONLY — the CTA moved out
            (see below), which is what actually makes the safe upward move
            possible: body has a hard max-w-[58%] cap, so EVERY line it
            ever wraps to is guaranteed to stay left of x:58%, regardless
            of body's real rendered height. That guarantee is what the
            unconstrained-width CTA never had (its natural width could
            exceed any assumed boundary) — CTA was the actual source of
            the earlier collision, not body.
            The collage is a normal-flow block starting right after body
            (mt-1 — correct by construction for whatever body's real
            height is, never an estimate) sized to h-[130px]. Image 2
            additionally reaches UP above the collage's own top via a
            small negative `top` offset, into the open space beside
            body's lower rows — safe regardless of body's actual height
            because it's anchored at right:2%/width:36%, i.e. left edge
            ≈62%, always clear of body's 58% cap. Image 1/3 are NOT
            pulled negative — they start at the collage's own (flow-safe)
            top, which is still ~70-90px higher than the previous pass's
            Image 1 position simply because there's no CTA + its margins
            sitting between body and the collage anymore. */}
        <div className="px-6 pb-3 pt-8 sm:hidden">
          <div>
            <h1 className="max-w-[90%] font-display text-[clamp(1.7rem,8.2vw,2rem)] font-bold leading-[0.97] tracking-tight text-ink">
              {headingContent}
            </h1>
            {/* Description micro pass: max-w-[58%]→[60%] (still clear of
                the coffee image's left edge at 61%, ~3-4px margin at
                every width since both are % of the same canvas) plus
                text-[17px]→[16px] — together aiming to reflow ~5 lines
                down to ~4 without shrinking the type noticeably. Color
                (text-ink/60) and leading ratio (1.425) unchanged. */}
            {description && (
              <p className="mt-8 max-w-[60%] text-[16px] leading-[1.425] text-ink/60">{description}</p>
            )}
          </div>

          {a && (
            // Image-scale micro pass: collage container grew 130→160px
            // (within the allowed 25–35px) purely to fit larger images
            // safely — geometry/concept otherwise unchanged. Image 1's
            // width (66%) and Image 2's width (36%, so its left edge
            // stays at the same safe ~62% clear of body's 58% cap) are
            // untouched — all the size increase below comes from height,
            // per "prioritize taller."
            <div className="relative mt-1 h-[133px] w-full">
              {/* Image 1 — dominant/anchor (bread). Spacing micro-fix:
                  now that Image 3 no longer exists on mobile, the
                  collage container's old h-[160px] left ~27px of
                  invisible dead space below bread's actual bottom edge
                  (bread's own top/height were percentages OF that
                  160px box, and only reached 83% of it) — that dead
                  space, not the CTA's own margin, was most of the
                  excess whitespace above the CTA. Container is now
                  h-[133px], matching bread's real bottom exactly.
                  Bread itself switched from percentage (top-[12%]
                  h-[71%], i.e. 19.2px/113.6px of the old 160px box) to
                  the equivalent FIXED pixels (top-[19.2px]
                  h-[113.6px]) so it renders at the exact same size/
                  position as before — unaffected by the container
                  resize, left edge (0) also unchanged. */}
              <div className="absolute left-0 top-[19.2px] h-[113.6px] w-[82.5%] overflow-hidden rounded-2xl shadow-md ring-2 ring-white">
                <SupabaseImage src={a} alt="" fill sizes="82vw" className="object-cover" />
              </div>
              {b && (
                // Image 2 — coffee, the only support image left on
                // mobile. Width-only increase: w-[30%]→w-[37.5%]
                // (exactly ×1.25). Height (161px), top (-119px), and
                // right-offset (1.5%) unchanged — still anchored
                // upper-right, still clear of body's 58%-capped column
                // (new left edge ~61%, still safely right of it), with a
                // bit more overlap onto bread as its left edge extends
                // further left — expected/acceptable per spec.
                <div className="absolute right-[1.5%] top-[-119px] z-10 h-[161px] w-[37.5%] overflow-hidden rounded-2xl shadow-md ring-4 ring-white">
                  <SupabaseImage src={b} alt="" fill sizes="38vw" className="object-cover" />
                </div>
              )}
              {/* Image 3 (pizza) intentionally not rendered on mobile —
                  two-image simplification pass. Its founder/admin field,
                  stored URL, and desktop rendering below are untouched;
                  `c` stays available to restore this block later without
                  any data/schema change. The resulting blank lower-right
                  space (below/right of bread, below coffee) is
                  intentional — do not fill it. */}
            </div>
          )}

          {/* CTA — copy + spacing micro pass: link label "Join FindMi."→
              "Get discovered." (same /join destination, no new route);
              mt-3.5→mt-3 (12px, was 14px) moves it slightly closer to
              the image above; the wrapper's own pb-3.5→pb-3 above trims
              the gap below it before the Hero ends. Font size, italic
              treatment, underline, and the padding/negative-margin tap-
              target preservation are all otherwise unchanged. */}
          <p className="mt-3 text-[8px] italic leading-[1.3] text-ink/40">
            Have a business?{" "}
            <Link
              href="/join"
              className="not-italic -my-[5px] -mx-1 inline-block px-1 py-[5px] font-medium text-ink/60 underline underline-offset-2 hover:text-ink"
            >
              Get discovered.
            </Link>
          </p>
        </div>

        {/* ================= DESKTOP (sm:+) — unchanged from the prior pass ================ */}
        <div className="hidden sm:flex sm:items-center sm:gap-8 sm:px-6 sm:py-10">
          <div className="min-w-0 flex-1 max-w-md">
            <h1 className="font-display text-3xl font-bold leading-[0.96] tracking-tight text-ink md:text-4xl">
              {headingContent}
            </h1>
            {description && <p className="mt-4 max-w-md text-base text-ink/60">{description}</p>}
            {/* CTA copy micro pass: label "Join FindMi."→"Get discovered."
                (same /join destination) — desktop spacing/typography/
                layout otherwise untouched. */}
            <p className="mt-2 text-sm italic text-ink/40">
              Have a business?{" "}
              <Link href="/join" className="not-italic font-medium text-ink/60 underline underline-offset-2 hover:text-ink">
                Get discovered.
              </Link>
            </p>
          </div>

          {a && (
            // Editorial collage: one dominant landscape image (top-left,
            // ~72%×70% of this box) with two smaller images staggered
            // over its top-right and bottom-right corners — all
            // percentage-sized so they scale with the box at every
            // breakpoint without per-tile breakpoint math.
            <div className="relative h-72 w-[22rem] shrink-0 lg:h-96 lg:w-[28rem] xl:h-[26rem] xl:w-[32rem]">
              <div className="absolute left-0 top-0 h-[70%] w-[72%] overflow-hidden rounded-3xl shadow-md ring-4 ring-white">
                <SupabaseImage
                  src={a}
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 330px, 253px"
                  className="object-cover"
                />
              </div>
              {b && (
                <div className="absolute right-0 top-0 z-10 h-[38%] w-[40%] overflow-hidden rounded-2xl shadow-md ring-4 ring-white">
                  <SupabaseImage
                    src={b}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 190px, 141px"
                    className="object-cover"
                  />
                </div>
              )}
              {c && (
                <div className="absolute bottom-0 right-[4%] z-10 h-[40%] w-[42%] overflow-hidden rounded-2xl shadow-md ring-4 ring-white">
                  <SupabaseImage
                    src={c}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 195px, 148px"
                    className="object-cover"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
