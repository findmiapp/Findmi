import SupabaseImage from "./SupabaseImage";

// Homepage Visual North Star V1 — full rewrite of the masthead around an
// approved visual reference: a large editorial serif headline, a short
// description, and an asymmetric real-world image collage (never a grid,
// never a carousel), with a small handwritten annotation inside the
// collage itself. Search/interests/discovery all live in page.tsx,
// immediately below this section.
//
// Headline/description are now FIXED copy (see the exact strings the
// visual spec requires), not routed through the founder's Site Editor →
// Hero heading/body fields anymore — those fields still exist and still
// hold whatever a founder last set, but this specific redesign has an
// exact, non-substitutable copy requirement. The founder's own Hero
// Image 1/2 slots are similarly no longer this component's image
// source — seebelow.
//
// `images` are REAL existing FindMi photos (business cover photos,
// product photos, event cover photos — already fetched by page.tsx for
// other sections; see its own note on how each role is chosen), never
// stock imagery. Every role is optional and independently omittable — a
// role with no real photo behind it simply doesn't render, so the
// collage always reflects exactly what's real, never a placeholder.
export interface HeroCollageImage {
  src: string;
  alt: string;
}

export interface HeroCollageImages {
  /** Left, dominant anchor image — brand/place. */
  left?: HeroCollageImage;
  /** Upper-right, medium — a real-world experience/place. */
  topRight?: HeroCollageImage;
  /** Small circular accent — product/culture. */
  circle?: HeroCollageImage;
  /** Lower-right, tall — experience/community. */
  bottomRight?: HeroCollageImage;
  /** Lower-center, medium — lifestyle/product/brand, overlapping `left`. */
  bottomCenter?: HeroCollageImage;
}

const HEADLINE_LINES = ["Discover", "what moves you."];
const DESCRIPTION = "Find brands, products, experiences,\nand see where they're popping up next.";

function Tile({
  image,
  className,
}: {
  image?: HeroCollageImage;
  className: string;
}) {
  if (!image) return null;
  return (
    <div className={className}>
      <SupabaseImage src={image.src} alt={image.alt} fill sizes="(min-width: 640px) 320px, 60vw" className="object-cover" />
    </div>
  );
}

function Annotation({ className }: { className: string }) {
  return (
    <div className={className}>
      <p className="font-hand text-[26px] leading-[0.95] text-ink/80">
        Brands.
        <br />
        Products.
        <br />
        Experiences.
        <br />
        IRL. <span aria-hidden>♥</span>
      </p>
    </div>
  );
}

export default function HomeHero({ images }: { images: HeroCollageImages }) {
  const hasCollage = Boolean(images.left || images.topRight || images.circle || images.bottomRight || images.bottomCenter);

  return (
    <section className="bg-paper">
      <div className="mx-auto max-w-6xl">
        {/* ================= MOBILE (<640px) ================= */}
        <div className="px-5 pb-3 pt-5 sm:hidden">
          <h1 className="font-editorial max-w-[92%] text-[2.55rem] font-semibold leading-[0.92] tracking-tight text-ink">
            {HEADLINE_LINES.map((line, i) => (
              <span key={i}>
                {line}
                {i < HEADLINE_LINES.length - 1 && <br />}
              </span>
            ))}
          </h1>
          <p className="mt-3 max-w-[86%] whitespace-pre-line text-[15px] leading-[1.4] text-ink/60">{DESCRIPTION}</p>

          {hasCollage && (
            <div className="relative mt-5 h-[430px] w-full">
              <Tile
                image={images.left}
                className="absolute left-0 top-0 h-[272px] w-[62%] overflow-hidden rounded-[28px] shadow-md ring-4 ring-white"
              />
              <Tile
                image={images.topRight}
                className="absolute right-[1%] top-0 z-10 h-[160px] w-[37%] overflow-hidden rounded-3xl shadow-md ring-4 ring-white"
              />
              <Tile
                image={images.circle}
                className="absolute right-[9%] top-[138px] z-20 aspect-square w-[23%] overflow-hidden rounded-full shadow-md ring-4 ring-white"
              />
              <Tile
                image={images.bottomRight}
                className="absolute right-[1%] top-[200px] z-10 h-[230px] w-[39%] overflow-hidden rounded-3xl shadow-md ring-4 ring-white"
              />
              <Tile
                image={images.bottomCenter}
                className="absolute left-[37%] top-[232px] z-20 h-[148px] w-[33%] -rotate-2 overflow-hidden rounded-2xl shadow-md ring-4 ring-white"
              />
              {images.left && <Annotation className="absolute left-0 top-[280px] w-[34%]" />}
            </div>
          )}
        </div>

        {/* ================= DESKTOP (sm:+) ================= */}
        <div className="hidden sm:flex sm:items-center sm:gap-10 sm:px-6 sm:py-12">
          <div className="min-w-0 flex-1 max-w-md">
            <h1 className="font-editorial text-5xl font-semibold leading-[0.94] tracking-tight text-ink md:text-6xl">
              {HEADLINE_LINES.map((line, i) => (
                <span key={i}>
                  {line}
                  {i < HEADLINE_LINES.length - 1 && <br />}
                </span>
              ))}
            </h1>
            <p className="mt-5 max-w-sm whitespace-pre-line text-base leading-[1.5] text-ink/60">{DESCRIPTION}</p>
          </div>

          {hasCollage && (
            <div className="relative h-[26rem] w-[26rem] shrink-0 lg:h-[30rem] lg:w-[32rem] xl:h-[34rem] xl:w-[38rem]">
              <Tile
                image={images.left}
                className="absolute left-0 top-0 h-[62%] w-[62%] overflow-hidden rounded-[32px] shadow-md ring-4 ring-white"
              />
              <Tile
                image={images.topRight}
                className="absolute right-[1%] top-0 z-10 h-[37%] w-[37%] overflow-hidden rounded-3xl shadow-md ring-4 ring-white"
              />
              <Tile
                image={images.circle}
                className="absolute right-[8%] top-[32%] z-20 aspect-square w-[21%] overflow-hidden rounded-full shadow-md ring-4 ring-white"
              />
              <Tile
                image={images.bottomRight}
                className="absolute right-[1%] top-[46%] z-10 h-[54%] w-[39%] overflow-hidden rounded-3xl shadow-md ring-4 ring-white"
              />
              <Tile
                image={images.bottomCenter}
                className="absolute left-[36%] top-[53%] z-20 h-[35%] w-[34%] -rotate-2 overflow-hidden rounded-2xl shadow-md ring-4 ring-white"
              />
              {images.left && <Annotation className="absolute left-0 top-[64%] w-[34%]" />}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
