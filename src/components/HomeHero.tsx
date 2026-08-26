import Image from "next/image";
import Link from "next/link";

// The homepage's masthead.
//
// Mobile geometry, several passes in: below sm:, copy sits in normal
// flow at the top, and the 3-image collage is a normal-flow block that
// starts right after it — its start position is always correct for
// whatever the text actually renders as (heading line count, body wrap),
// never an estimate. Within its own box, the images are absolutely
// positioned/overlapped in a staggered diagonal composition (percentages
// of that box, so 360–430px scales cleanly). See the mobile branch below
// for the exact numbers and the collision root-cause this fixed.
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
        {/* ================= MOBILE (<640px) — CTA collision fix ================
            ROOT CAUSE of the live clipping: the previous pass absolutely-
            positioned all 3 images against a FIXED-height outer canvas,
            with each image's `top` chosen from an ESTIMATED text-block
            height. That estimate was too short for the actual rendered
            text (in particular, the body paragraph wraps to more lines
            at its narrow ~58% width than assumed) — so Image 1's
            estimated-safe top (57.5% of the fixed canvas) actually landed
            ON TOP of the CTA line. Because Image 1 is `position: absolute`
            and the text block is plain static flow, the image painted
            above the text wherever they overlapped, regardless of
            z-index — static content is always below positioned content
            in paint order.
            THE FIX: the collage is no longer positioned against a fixed
            canvas at all. It's now a normal-flow block that starts AFTER
            the text div ends (a small mt-3 gap, no negative margin) — so
            its vertical start position is always correct, by construction,
            for whatever the text actually renders as (2-line or 3-line
            heading, however many lines the body wraps to). This is a
            structural guarantee, not another height estimate. Images are
            then absolutely positioned/overlapped WITHIN that collage's own
            box (h-[175px], not the whole hero) — same diagonal composition
            as before, Image 1 shifted slightly right, Image 2 moved up
            relative to Image 1 and kept far right, Image 3 unchanged
            relative to Image 1. For the current 2-line-heading copy this
            lands the whole Hero at ~476px (within "approximately 470px");
            a founder-configured 3-line heading would push it somewhat
            taller — still zero collision, just not exactly 470px in that
            edge case, which this pass treats as the correct trade-off per
            "text first, CTA fully visible, then position images." */}
        <div className="px-6 pb-5 pt-8 sm:hidden">
          <div>
            <h1 className="max-w-[90%] font-display text-[clamp(1.7rem,8.2vw,2rem)] font-bold leading-[0.97] tracking-tight text-ink">
              {headingContent}
            </h1>
            {description && (
              <p className="mt-8 max-w-[58%] text-[17px] leading-[1.425] text-ink/60">{description}</p>
            )}
            <p className="mt-6 text-[16px] italic leading-[1.3] text-ink/40">
              Have a business?{" "}
              <Link href="/join" className="not-italic font-medium text-ink/60 underline underline-offset-2 hover:text-ink">
                Join FindMi.
              </Link>
            </p>
          </div>

          {a && (
            // Collage box — normal flow, starts after the CTA with a
            // small fixed gap. Images below are positioned relative to
            // THIS box (percentages of 342×175 reference), not the hero.
            <div className="relative mt-3 h-[175px] w-full">
              {/* Image 1 — dominant/anchor. Shifted right (left: 17%,
                  was 14%) per the requested composition. */}
              <div className="absolute left-[17%] top-[22%] h-[68%] w-[66%] overflow-hidden rounded-2xl shadow-md ring-2 ring-white">
                <Image src={a} alt="" fill sizes="66vw" className="object-cover" />
              </div>
              {b && (
                // Image 2 — upper-right support. Starts at the collage's
                // own top (top: 0), i.e. above/before Image 1 (top: 22%)
                // — "moved up relative to Image 1" — and stays far right
                // (right: 2%). Entirely inside the collage box, which
                // itself only begins after the CTA, so it can never
                // reach the text regardless of its position here.
                <div className="absolute right-[2%] top-0 z-10 h-[55%] w-[36%] overflow-hidden rounded-2xl shadow-md ring-4 ring-white">
                  <Image src={b} alt="" fill sizes="36vw" className="object-cover" />
                </div>
              )}
              {c && (
                // Image 3 — lower-right support, same position relative
                // to Image 1 as before (overlapping its lower-right).
                <div className="absolute right-[3%] top-[58%] z-10 h-[42%] w-[37%] overflow-hidden rounded-2xl shadow-md ring-4 ring-white">
                  <Image src={c} alt="" fill sizes="37vw" className="object-cover" />
                </div>
              )}
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
