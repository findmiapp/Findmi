import Image from "next/image";
import Link from "next/link";

// The homepage's masthead.
//
// Mobile geometry, several passes in: below sm:, the hero is one
// `relative` canvas — copy sits in normal flow at its top-left, and all
// three images are absolutely positioned within that SAME canvas
// (percentages of its width/height, so the composition scales cleanly
// across 360–430px without hiding anything or reverting to a stack).
// The copy and collage occupy overlapping VERTICAL bands of that canvas
// (Image 2 starts alongside the copy's lower region, not after it) while
// staying clear of the text HORIZONTALLY — narrowing the body column is
// what actually opens the room for that, not pushing images down below
// all the text. See the mobile branch below for the exact numbers.
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
        {/* ================= MOBILE (<640px) — reference geometry match ================
            Reference-literal rebuild: the prior pass fixed collisions by
            waiting for ALL images until after the full text block ended,
            which produced the "text block, then image block" layout the
            reference explicitly rejects. This version instead narrows the
            body copy (its own target width, ~58%) so Image 2 fits in the
            newly-open space BESIDE it — overlapping the copy's vertical
            band without ever crossing into body's horizontal footprint
            (body's right edge sits ~15px left of Image 2's left edge).
            Coordinates below are converted from the supplied 390px-wide
            reference (24px inner padding either side, 342px usable canvas)
            into percentages of this canvas, so 360–430px scales
            proportionally without hiding anything. One deliberate
            deviation from the literal reference numbers: Image 2's `top`
            is nudged down from the reference's ~158px-canvas-relative to
            ~219px — just past the CTA's own row — because the CTA is
            intentionally left unconstrained-width (see below) and the
            literal higher position would have let a full-width CTA line
            visually run under it. Canvas h-[414px] + pt-8/pb-6/px-6
            framing lands the whole Hero at ~470px, within the 460–490px
            target (was ~510px). */}
        <div className="relative h-[414px] px-6 pb-6 pt-8 sm:hidden">
          <div>
            <h1 className="max-w-[90%] font-display text-[clamp(1.7rem,8.2vw,2rem)] font-bold leading-[0.97] tracking-tight text-ink">
              {headingContent}
            </h1>
            {/* ~58% width (was ~60%, still the "narrower on purpose"
                target) — this is what actually opens up the right-hand
                space for Image 2 to sit beside it instead of below it. */}
            {description && (
              <p className="mt-8 max-w-[58%] text-[17px] leading-[1.425] text-ink/60">{description}</p>
            )}
            {/* Unconstrained width, per spec ("do not constrain it to a
                narrow column") — reads as one line at 390px+. Image 2 is
                positioned to start just after this line ends (see its
                own note below), so there's nothing here for it to
                collide with regardless of the line's exact rendered
                width. */}
            <p className="mt-6 text-[16px] italic leading-[1.3] text-ink/40">
              Have a business?{" "}
              <Link href="/join" className="not-italic font-medium text-ink/60 underline underline-offset-2 hover:text-ink">
                Join FindMi.
              </Link>
            </p>
          </div>

          {a && (
            // Image 1 — dominant landscape, the collage's anchor. Begins
            // left-of-center and extends right — clearly the largest
            // tile, but nowhere near full hero width.
            <div className="absolute left-[14%] top-[57.5%] h-[35%] w-[69%] overflow-hidden rounded-2xl shadow-md ring-2 ring-white">
              <Image src={a} alt="" fill sizes="69vw" className="object-cover" />
            </div>
          )}
          {b && (
            // Image 2 — upper-right support, sitting beside the copy's
            // lower region (body ends at ~58% width; this starts at
            // 60%, clearing it) rather than waiting for the whole text
            // block to finish. Overlaps Image 1's upper-right corner
            // (z-10, on top). See the file-level note above re: its top
            // offset vs. the literal reference number.
            <div className="absolute left-[60%] top-[53%] z-10 h-[35%] w-[37%] overflow-hidden rounded-2xl shadow-md ring-4 ring-white">
              <Image src={b} alt="" fill sizes="37vw" className="object-cover" />
            </div>
          )}
          {c && (
            // Image 3 — lower-right support, overlapping Image 1's
            // lower-right corner, extending nearly to the canvas's own
            // right edge (matches the reference's near-flush placement).
            <div className="absolute left-[60%] top-[73%] z-10 h-[25%] w-[40%] overflow-hidden rounded-2xl shadow-md ring-4 ring-white">
              <Image src={c} alt="" fill sizes="40vw" className="object-cover" />
            </div>
          )}
        </div>

        {/* ================= DESKTOP (sm:+) — unchanged from the prior pass ================ */}
        <div className="hidden sm:flex sm:items-center sm:gap-8 sm:px-6 sm:py-10">
          <div className="min-w-0 flex-1 max-w-md">
            <h1 className="font-display text-3xl font-bold leading-[0.96] tracking-tight text-ink md:text-4xl">
              {headingContent}
            </h1>
            {description && <p className="mt-4 max-w-md text-base text-ink/60">{description}</p>}
            <p className="mt-2 text-sm italic text-ink/40">
              Have a business?{" "}
              <Link href="/join" className="not-italic font-medium text-ink/60 underline underline-offset-2 hover:text-ink">
                Join FindMi.
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
                <Image
                  src={a}
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 330px, 253px"
                  className="object-cover"
                />
              </div>
              {b && (
                <div className="absolute right-0 top-0 z-10 h-[38%] w-[40%] overflow-hidden rounded-2xl shadow-md ring-4 ring-white">
                  <Image
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
                  <Image
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
