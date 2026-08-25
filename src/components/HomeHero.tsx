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
// line remains as a hard guarantee. Line-height is tightened to 0.98
// (was 1.1) for the tighter, more confident/editorial feel that was
// asked for — loose 1.1+ leading on a 3-line headline is what reads as
// "stacked." font-extrabold is a deliberate one-off step up from
// font-bold (the strongest weight used anywhere else in the app) for
// this one headline specifically — Inter loads as a variable font (no
// fixed `weight` in next/font/google's config), so every weight up to
// 900 renders natively, not browser-synthesized. sm:/md: sizes are more
// conservative than the previous pass (text-3xl/text-4xl, not
// text-4xl/text-5xl) for the same one-line-guarantee reason, now applied
// at every breakpoint instead of only on mobile.
export default function HomeHero({ images }: { images: string[] }) {
  const [a, b, c] = images;

  return (
    <section className="border-b border-black/5 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-10">
        <div className="flex items-center gap-3 sm:gap-12">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[clamp(1.1rem,5vw,1.375rem)] font-extrabold leading-[0.98] tracking-tight text-ink sm:text-3xl md:text-4xl">
              Find what&rsquo;s
              <br />
              around you.
              <br />
              <span className="whitespace-nowrap text-findmi-600">Get discovered.</span>
            </h1>
            <p className="mt-2.5 max-w-[26ch] text-xs text-ink/60 sm:mt-4 sm:max-w-md sm:text-base">
              Discover local businesses, events, pop-ups, products, and more — all in one place.
            </p>
            {/* UI cleanup pass item 8 — understated, not another CTA
                block: small italic text, only the last few words link. */}
            <p className="mt-1.5 text-[11px] italic text-ink/40 sm:mt-2 sm:text-sm">
              Have a business?{" "}
              <Link href="/join" className="not-italic font-medium text-ink/60 underline underline-offset-2 hover:text-ink">
                Join FindMi today.
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
