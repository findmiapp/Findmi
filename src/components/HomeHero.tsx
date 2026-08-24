import Image from "next/image";

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
// Headline is three deliberate lines (live QA correction, 2026 nav pass):
// forced <br/> breaks rather than relying on wrapping, so "Find what's" /
// "around you." / "Get discovered." always renders as three lines
// regardless of viewport width. font-extrabold is a deliberate one-off
// step up from font-bold (the strongest weight used anywhere else in the
// app) for this one headline specifically — Inter loads as a variable
// font (no fixed `weight` in next/font/google's config), so every weight
// up to 900 renders natively, not browser-synthesized.
export default function HomeHero({ images }: { images: string[] }) {
  const [a, b, c] = images;

  return (
    <section className="border-b border-black/5 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-10">
        <div className="flex items-center gap-3 sm:gap-12">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-extrabold leading-[1.1] tracking-tight text-ink sm:text-4xl md:text-5xl">
              Find what&rsquo;s
              <br />
              around you.
              <br />
              <span className="text-findmi-600">Get discovered.</span>
            </h1>
            <p className="mt-2.5 max-w-[26ch] text-xs text-ink/60 sm:mt-4 sm:max-w-md sm:text-base">
              Discover local businesses, events, pop-ups, products, and more — all in one place.
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
