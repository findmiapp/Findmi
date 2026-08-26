import Image from "next/image";
import Link from "next/link";

// The homepage's masthead. Editorial-collage pass: rebuilt around an
// approved mobile reference mockup (decorative background scribbles from
// that reference explicitly excluded — out of scope). Copy sits upper-
// left with a full, comfortable reading width; the image collage sits
// BELOW and to the right of it (stacked on mobile, side-by-side from
// sm: up), built around one dominant landscape image with two smaller
// images staggered/overlapping its top-right and bottom-right corners —
// not three same-weight thumbnails. All three real images stay visible
// at every width; nothing is hidden on mobile purely to simplify the
// layout (previous pass hid the third tile on mobile — this one doesn't).
// `images` are real cover photos already fetched for other homepage
// sections (featured businesses / the live appearances feed) — never
// stock/decorative photography, never fabricated: with fewer than 3
// available, this renders however many real ones there are, and with
// zero it renders no collage at all.
//
// Geometry changed; editability didn't — heading/body/CTA and all three
// image slots are still the same founder-editable Site Editor fields
// (Hero → Heading/Body/Image 1-3), untouched by this pass.
//
// Headline is three deliberate lines, all at the SAME size (second
// live-QA correction — the previous pass gave the third line its own
// smaller size to stop it wrapping, which fixed the wrap but produced a
// new, worse problem: an inconsistent, "startup-ish" hierarchy where the
// business payoff line read as visually secondary). This version instead
// finds the single largest mobile size at which the LONGEST line ("Get
// discovered.") still fits on one line, and uses that size everywhere —
// so the constraint is solved by sizing the whole headline around it,
// not by shrinking one line in isolation. `whitespace-nowrap` on that
// line remains as a hard guarantee.
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

  return (
    <section className="border-b border-black/5 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-10">
        {/* Stacked (copy, then collage below-right of it) on mobile —
            NOT two tiny side-by-side columns. From sm: up, the same two
            elements sit in a row: copy is capped (sm:max-w-md) so it
            stops growing once comfortably readable, letting the collage
            sit right after it with a real, fixed gap rather than hugging
            the container's far-right edge. items-center is sm-only —
            unset on mobile so the stacked copy block stretches to its
            full natural width instead of shrinking to content width.
            Mobile micro-fix: gap-2 (was gap-5) — the collage's own
            -mt-3 (below) does the real work of tucking it right up
            against the CTA line instead of leaving a big dead gap; sm:
            is untouched. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-8">
          <div className="min-w-0 flex-1 sm:max-w-md">
            <h1 className="font-display text-[clamp(1.15rem,5.1vw,1.4rem)] font-bold leading-[0.96] tracking-tight text-ink sm:text-3xl md:text-4xl">
              {headingLines.map((line, i) => (
                <span key={i}>
                  {i === lastIndex ? <span className="whitespace-nowrap text-findmi-600">{line}</span> : line}
                  {i < lastIndex && <br />}
                </span>
              ))}
            </h1>
            {/* Founder-editable via Site Editor → Hero → Body (UI cleanup
                pass item 3) — falls back to this same default copy when
                unconfigured, via resolveSection/HOMEPAGE_SECTIONS. */}
            {description && (
              <p className="mt-2.5 max-w-[30ch] text-xs text-ink/60 sm:mt-4 sm:max-w-md sm:text-base">
                {description}
              </p>
            )}
            {/* UI cleanup pass item 8 — understated, not another CTA
                block: small italic text, only the last few words link. */}
            <p className="mt-1.5 text-[11px] italic text-ink/40 sm:mt-2 sm:text-sm">
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
            // breakpoint without per-tile breakpoint math. ml-auto on
            // mobile pushes the whole collage toward the right, under
            // the copy, per the approved reference ("below and to the
            // right of copy," not a narrow column beside it); sm:ml-0
            // resets that once copy/collage sit side-by-side in a row.
            // Sizes grow from a genuinely large mobile presence (not a
            // thumbnail) up through a substantially bigger desktop one.
            //
            // Mobile positioning micro-fix: -mt-3 (paired with the
            // parent's gap-2 above) tucks the whole box up snug against
            // the CTA line instead of after a big dead gap — a small,
            // safe overlap since "a"/"c" sit well clear of the (already
            // narrow, ~30ch-capped) body/CTA text horizontally. h-52
            // (was h-60) trims a modest amount of height without
            // shrinking toward "tiny thumbnail" territory. sm:mt-0/
            // sm:h-72 reset both — tablet/desktop sizing is untouched.
            <div className="relative -mt-3 ml-auto h-52 w-[84%] shrink-0 sm:mt-0 sm:ml-0 sm:h-72 sm:w-[22rem] lg:h-96 lg:w-[28rem] xl:h-[26rem] xl:w-[32rem]">
              <div className="absolute left-0 top-0 h-[70%] w-[72%] overflow-hidden rounded-2xl shadow-md ring-2 ring-white sm:rounded-3xl sm:ring-4">
                <Image
                  src={a}
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 330px, (min-width: 640px) 253px, 60vw"
                  className="object-cover"
                />
              </div>
              {b && (
                // Rises independently ABOVE the box's own top on mobile
                // only (top-[-3.5rem], reset to top-0 at sm:) — this is
                // the "upper supporting image rises alongside the lower
                // text/CTA area" requirement. Safe because it's confined
                // to the box's own right 40%, and body/CTA copy is
                // already capped well short of that width (see the
                // 30ch max-width on the body paragraph above).
                <div className="absolute right-0 top-[-3.5rem] z-10 h-[38%] w-[40%] overflow-hidden rounded-xl shadow-md ring-2 ring-white sm:top-0 sm:rounded-2xl sm:ring-4">
                  <Image
                    src={b}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 190px, (min-width: 640px) 141px, 34vw"
                    className="object-cover"
                  />
                </div>
              )}
              {c && (
                <div className="absolute bottom-0 right-[4%] z-10 h-[40%] w-[42%] overflow-hidden rounded-xl shadow-md ring-2 ring-white sm:rounded-2xl sm:ring-4">
                  <Image
                    src={c}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 195px, (min-width: 640px) 148px, 35vw"
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
