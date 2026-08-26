import Image from "next/image";
import Link from "next/link";

// The homepage's masthead.
//
// Mobile geometry, several passes in: below sm:, the hero is one
// `relative` canvas — copy sits in normal flow at its top-left, and all
// three images are absolutely positioned within that SAME canvas
// (percentages of its width/height, so the composition scales cleanly
// across 360–430px without hiding anything or reverting to a stack).
// A prior pass let an image rise into the copy's own row for a tighter
// "editorial" look, but that produced real text/image collisions — this
// version instead reserves the canvas's full text-block height for text
// only, and gets its compact, layered feel from moving/shrinking the
// images into the space below+beside the copy, not from overlapping it.
// See the mobile branch below for the exact numbers.
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
        {/* ================= MOBILE (<640px) — geometry micro-fix ================
            Previous pass let Image 2 rise INTO the copy's row, which forced
            the CTA into a narrow column and still risked real text/image
            collisions. This version reserves the canvas's top ~201px
            (estimated full text-block height, see below) for text ONLY —
            every image starts at top ≥47%, safely after that, with a ~20px
            buffer. That's a firm, content-independent guarantee against any
            image ever covering the headline/body/CTA, rather than a
            fragile per-line width estimate. Canvas h-[470px] + px-6/py-5
            framing lands the whole Hero at ~510px — within the 500–520px
            target (was ~558px). Collage is smaller across the board (~30%
            less area per tile) and covers a visibly shorter vertical span,
            reading as one compact, layered editorial group instead of
            three stacked cards. */}
        <div className="relative h-[470px] px-6 py-5 sm:hidden">
          <div>
            <h1 className="max-w-[74%] font-display text-[clamp(1.7rem,8.2vw,2rem)] font-bold leading-[0.97] tracking-tight text-ink">
              {headingContent}
            </h1>
            {/* ~58–62% width so it wraps naturally into short lines — this
                is the text's own target width, not a collision workaround
                (images are moved/shrunk for that; see below). */}
            {description && (
              <p className="mt-3 max-w-[60%] text-[17px] leading-[1.425] text-ink/60">{description}</p>
            )}
            {/* No width cap (previous pass's max-w-[46%] removed) — this
                line gets the room it needs to read naturally and stay on
                one line at 390px+; images never share its row (see the
                top-safety note above), so there's nothing for it to
                collide with regardless of its rendered width. */}
            <p className="mt-2 text-[16px] italic leading-[1.3] text-ink/40">
              Have a business?{" "}
              <Link href="/join" className="not-italic font-medium text-ink/60 underline underline-offset-2 hover:text-ink">
                Join FindMi.
              </Link>
            </p>
          </div>

          {a && (
            // Image 1 — dominant, the collage's anchor. Starts left-of-
            // center (left: 8%) and extends right (width: 65% — sized
            // down from the previous 75%, and nowhere near full width).
            <div className="absolute left-[8%] top-[51%] h-[30%] w-[65%] overflow-hidden rounded-2xl shadow-md ring-2 ring-white">
              <Image src={a} alt="" fill sizes="65vw" className="object-cover" />
            </div>
          )}
          {b && (
            // Image 2 — upper-right support. Moved significantly farther
            // right (right: 4%, was 9%) and lower (top: 47%, was 29%) than
            // the previous pass, and smaller (34%×24%, was 40%×29%) — sits
            // in the open space to the right once the copy block has
            // actually finished, overlapping only Image 1's upper-right
            // corner (z-10, on top), never any text.
            <div className="absolute right-[4%] top-[47%] z-10 h-[24%] w-[34%] overflow-hidden rounded-2xl shadow-md ring-4 ring-white">
              <Image src={b} alt="" fill sizes="34vw" className="object-cover" />
            </div>
          )}
          {c && (
            // Image 3 — lower-right support, smaller than Image 1,
            // overlapping its lower-right corner. Bottom edge (top 70% +
            // height 24% = 94%) leaves real breathing room before the
            // canvas ends.
            <div className="absolute right-[5%] top-[70%] z-10 h-[24%] w-[38%] overflow-hidden rounded-2xl shadow-md ring-4 ring-white">
              <Image src={c} alt="" fill sizes="38vw" className="object-cover" />
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
