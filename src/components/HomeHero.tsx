import Image from "next/image";
import Link from "next/link";

// The homepage's masthead — deliberately short (mobile target ~200-240px,
// not a giant intro screen). Copy left, a staggered collage right, even
// on mobile: side-by-side (not stacked) is what keeps this compact, since
// the section's height is driven by the taller of the two, not their
// sum. `images` are real cover photos already fetched for other homepage
// sections (featured businesses / the live appearances feed) — never
// stock/decorative photography, and never fabricated: with fewer than 3
// available, this renders however many real ones there are, and with
// zero it renders no collage at all rather than a placeholder.
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
//
// 2nd cleanup pass (item 8): font-bold (was font-extrabold — a lighter,
// narrower weight at the same size), leading tightened to 0.96 (was
// 0.98), and the mobile clamp nudged up slightly (1.1rem/5vw/1.375rem →
// 1.15rem/5.1vw/1.4rem). The lighter weight's narrower glyph advance
// roughly offsets the slightly larger size, which is why the min bound
// only moved ~2% (1.1rem→1.15rem) despite the size read as more
// noticeably "up" at normal viewing distance — the one-line guarantee at
// 360px was the hard constraint the whole adjustment was sized around,
// not just this line's own size in isolation. `whitespace-nowrap` on
// "Get discovered." remains the hard backstop either way. sm:/md: sizes
// (text-3xl/text-4xl) are unchanged from the prior pass — this item's
// ask was weight/line-height/mobile-size, not the larger breakpoints.
export default function HomeHero({ images, description }: { images: string[]; description: string | null }) {
  const [a, b, c] = images;

  return (
    <section className="border-b border-black/5 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-10">
        <div className="flex items-center gap-3 sm:gap-12">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[clamp(1.15rem,5.1vw,1.4rem)] font-bold leading-[0.96] tracking-tight text-ink sm:text-3xl md:text-4xl">
              Find what&rsquo;s
              <br />
              around you.
              <br />
              <span className="whitespace-nowrap text-findmi-600">Get discovered.</span>
            </h1>
            {/* Founder-editable via Site Editor → Hero → Body (UI cleanup
                pass item 3) — falls back to this same default copy when
                unconfigured, via resolveSection/HOMEPAGE_SECTIONS. */}
            {description && (
              <p className="mt-2.5 max-w-[26ch] text-xs text-ink/60 sm:mt-4 sm:max-w-md sm:text-base">
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
            <div className="relative h-32 w-[42vw] max-w-[190px] shrink-0 sm:h-72 sm:w-64">
              <div className="absolute left-0 top-1 z-10 h-[62%] w-[62%] overflow-hidden rounded-xl shadow-sm ring-2 ring-white sm:h-44 sm:w-44 sm:rounded-2xl sm:ring-4">
                <Image src={a} alt="" fill sizes="(min-width: 640px) 176px, 30vw" className="object-cover" />
              </div>
              {b && (
                <div className="absolute right-0 top-0 h-[38%] w-[38%] overflow-hidden rounded-lg shadow-sm ring-2 ring-white sm:h-28 sm:w-28 sm:rounded-xl sm:ring-4">
                  <Image src={b} alt="" fill sizes="(min-width: 640px) 112px, 18vw" className="object-cover" />
                </div>
              )}
              {c && (
                <div className="absolute bottom-0 right-[14%] z-10 h-[44%] w-[44%] overflow-hidden rounded-lg shadow-sm ring-2 ring-white sm:bottom-0 sm:right-8 sm:h-32 sm:w-32 sm:rounded-xl sm:ring-4">
                  <Image src={c} alt="" fill sizes="(min-width: 640px) 128px, 20vw" className="object-cover" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
