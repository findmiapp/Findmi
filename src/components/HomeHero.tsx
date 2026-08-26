import Image from "next/image";
import Link from "next/link";

// The homepage's masthead.
//
// Precision mobile rebuild pass: two incremental geometry passes on a
// stacked "copy block, then collage block" layout still didn't match the
// approved reference — the reference wants text and images sharing ONE
// editorial canvas with real overlapping regions, not two sequential
// sections. Below sm:, the whole hero is now genuinely rebuilt around a
// single `relative` canvas: copy sits in normal flow at its top-left, and
// all three images are absolutely positioned within that SAME canvas
// (percentages of its width/height, so the composition scales cleanly
// across 360–430px without hiding anything or reverting to a stack).
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
        {/* ================= MOBILE (<640px) — precision rebuild ================
            One relative canvas, fixed at 510px tall (with px-6/py-6 framing,
            lands the whole Hero around 558px — within the 500–560px target).
            Copy is a normal-flow block capped to roughly the left 3/4 of the
            canvas; all three images are absolutely positioned as percentages
            of this same canvas, so they scale proportionally at 360–430px
            without ever needing to hide one. Image 2 deliberately starts
            while the copy block is still finishing (its lower body line /
            CTA) rather than after it — that's the "one editorial canvas"
            effect the reference wants. The CTA line gets its own narrower
            width cap so it wraps to two short lines instead of running
            underneath Image 2 — a geometry-only consequence, its text/link
            are unchanged. */}
        <div className="relative h-[510px] px-6 py-6 sm:hidden">
          <div className="max-w-[74%]">
            <h1 className="font-display text-[clamp(1.7rem,8.2vw,2rem)] font-bold leading-[0.97] tracking-tight text-ink">
              {headingContent}
            </h1>
            {description && (
              <p className="mt-3 max-w-[76%] text-[17px] leading-[1.425] text-ink/60">{description}</p>
            )}
            <p className="mt-2 max-w-[46%] text-[16px] italic leading-[1.3] text-ink/40">
              Have a business?{" "}
              <Link href="/join" className="not-italic font-medium text-ink/60 underline underline-offset-2 hover:text-ink">
                Join FindMi.
              </Link>
            </p>
          </div>

          {a && (
            // Image 1 — dominant landscape. Begins after the copy block
            // (top: 49%) and extends well toward the right (left: 21%,
            // width: 75%) rather than sitting in a narrow column.
            <div className="absolute left-[21%] top-[49%] h-[34%] w-[75%] overflow-hidden rounded-2xl shadow-md ring-2 ring-white">
              <Image src={a} alt="" fill sizes="75vw" className="object-cover" />
            </div>
          )}
          {b && (
            // Image 2 — upper-right support. Starts at top: 29%, i.e.
            // alongside the copy's lower body/CTA region, not after the
            // whole collage — and overlaps down onto Image 1's top-right
            // corner (z-10, on top).
            <div className="absolute right-[9%] top-[29%] z-10 h-[29%] w-[40%] overflow-hidden rounded-2xl shadow-md ring-4 ring-white">
              <Image src={b} alt="" fill sizes="40vw" className="object-cover" />
            </div>
          )}
          {c && (
            // Image 3 — lower-right support, overlapping Image 1's
            // lower-right corner. Bottom edge (top 70% + height 25% = 95%)
            // leaves ~25px of breathing room before the canvas ends.
            <div className="absolute right-[7%] top-[70%] z-10 h-[25%] w-[48%] overflow-hidden rounded-2xl shadow-md ring-4 ring-white">
              <Image src={c} alt="" fill sizes="48vw" className="object-cover" />
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
