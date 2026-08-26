import Image from "next/image";
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
        <div className="px-6 pb-5 pt-8 sm:hidden">
          <div>
            <h1 className="max-w-[90%] font-display text-[clamp(1.7rem,8.2vw,2rem)] font-bold leading-[0.97] tracking-tight text-ink">
              {headingContent}
            </h1>
            {description && (
              <p className="mt-8 max-w-[58%] text-[17px] leading-[1.425] text-ink/60">{description}</p>
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
            <div className="relative mt-1 h-[160px] w-full">
              {/* Image 1 — dominant/anchor (bread). Width-only micro
                  pass: w-[66%]→w-[82.5%] (exactly ×1.25). left (17%) and
                  height (71%) unchanged, so the extra width extends
                  rightward only — left edge, top edge, and height all
                  stay put. 17%+82.5%=99.5% of the collage width, so it
                  reaches nearly to the canvas's right edge without
                  overflowing it. */}
              <div className="absolute left-[17%] top-[12%] h-[71%] w-[82.5%] overflow-hidden rounded-2xl shadow-md ring-2 ring-white">
                <Image src={a} alt="" fill sizes="82vw" className="object-cover" />
              </div>
              {b && (
                // Image 2 — coffee. Balance pass: width-only reduction,
                // w-[36%]→w-[30%] (~16.7% narrower, within 15–20%), plus
                // a small extra rightward nudge (right-[2%]→right-[1.5%])
                // beyond what the narrower box already gains from being
                // right-anchored. Height (161px) and top (-119px)
                // unchanged — still the tall upper-right accent, still
                // clear of body's 58%-capped column (now with MORE
                // horizontal margin than before, since it's narrower).
                <div className="absolute right-[1.5%] top-[-119px] z-10 h-[161px] w-[30%] overflow-hidden rounded-2xl shadow-md ring-4 ring-white">
                  <Image src={b} alt="" fill sizes="30vw" className="object-cover" />
                </div>
              )}
              {c && (
                // Image 3 — pizza. Balance pass: height cut substantially
                // from the previous h-[72%] down to h-[50%] — measured
                // against the PRE-double-height baseline (h-[36%], i.e.
                // 57.6px) this is ~38.9% taller, within the requested
                // 35–45% (not the previous pass's 100%). Width (37%)
                // unchanged, so at 126.5w×80h it's clearly landscape.
                // right-[2.6%]→right-[0.5%] moves it much closer to the
                // true right edge — noticeably farther right than Image
                // 2's own right edge, so the two no longer share the
                // same right boundary. top-[10%]→top-[28%] moves it
                // lower, clearing Image 2's bottom instead of touching
                // it, so the three read as separate diagonal tiles
                // (coffee upper-right, bread anchor, pizza lower-right)
                // rather than coffee+pizza forming one vertical column.
                // Still solidly inside bread's own lower-right region.
                <div className="absolute right-[0.5%] top-[28%] z-10 h-[50%] w-[37%] overflow-hidden rounded-2xl shadow-md ring-4 ring-white">
                  <Image src={c} alt="" fill sizes="37vw" className="object-cover" />
                </div>
              )}
            </div>
          )}

          {/* CTA — moved below the dominant image/collage (was above it,
              between body and the collage). Same text/link/behavior,
              just relocated and tightened into a small caption-like
              spacing (mt-3) instead of the old mt-6. This is also what
              removes the collision risk at its root — nothing
              unconstrained-width sits beside the collage anymore. */}
          <p className="mt-3 text-[16px] italic leading-[1.3] text-ink/40">
            Have a business?{" "}
            <Link href="/join" className="not-italic font-medium text-ink/60 underline underline-offset-2 hover:text-ink">
              Join FindMi.
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
