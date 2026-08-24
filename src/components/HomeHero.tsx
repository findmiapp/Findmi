import Image from "next/image";

// The homepage's masthead — deliberately short (mobile target ~180-220px,
// not a giant intro screen). Copy left, a small staggered collage right,
// even on mobile: side-by-side (not stacked) is what keeps this compact,
// since the section's height is driven by the taller of the two, not
// their sum. `images` are real cover photos already fetched for other
// homepage sections (featured businesses / the live appearances feed) —
// never stock/decorative photography, and never fabricated: with fewer
// than 3 available, this renders however many real ones there are, and
// with zero it renders no collage at all rather than a placeholder.
export default function HomeHero({ images }: { images: string[] }) {
  const [a, b, c] = images;

  return (
    <section className="border-b border-black/5 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6 sm:py-10">
        <div className="flex items-center gap-4 sm:gap-12">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-xl font-bold leading-[1.15] tracking-tight text-ink sm:text-4xl md:text-5xl">
              Find what&rsquo;s around you.
              <br />
              <span className="text-findmi-600">Get discovered.</span>
            </h1>
            <p className="mt-2 max-w-md text-xs text-ink/60 sm:mt-4 sm:text-base">
              Discover local businesses, events, pop-ups, products, and more — all in one place.
            </p>
          </div>

          {a && (
            <div className="relative h-24 w-24 shrink-0 sm:h-72 sm:w-64">
              <div className="absolute left-0 top-1 z-10 h-16 w-16 overflow-hidden rounded-xl shadow-sm ring-2 ring-white sm:h-44 sm:w-44 sm:rounded-2xl sm:ring-4">
                <Image src={a} alt="" fill sizes="(min-width: 640px) 176px, 64px" className="object-cover" />
              </div>
              {b && (
                <div className="absolute right-0 top-0 h-10 w-10 overflow-hidden rounded-lg shadow-sm ring-2 ring-white sm:h-28 sm:w-28 sm:rounded-xl sm:ring-4">
                  <Image src={b} alt="" fill sizes="(min-width: 640px) 112px, 40px" className="object-cover" />
                </div>
              )}
              {c && (
                <div className="absolute bottom-0 right-4 z-10 h-12 w-12 overflow-hidden rounded-lg shadow-sm ring-2 ring-white sm:bottom-0 sm:right-8 sm:h-32 sm:w-32 sm:rounded-xl sm:ring-4">
                  <Image src={c} alt="" fill sizes="(min-width: 640px) 128px, 48px" className="object-cover" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
