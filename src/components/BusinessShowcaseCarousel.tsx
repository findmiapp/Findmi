"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import type { ShowcaseBusinessData } from "@/lib/data";
import { cityState, formatCurrency, formatDateShort } from "@/lib/format";

// Compact swipeable business-acquisition showcase — native CSS scroll-snap
// (no carousel library) so it's touch-native and lightweight. Demonstrates
// with FindMi's own real data (The Native Rose — see lib/data.ts's
// getShowcaseBusiness): real logo/cover/product photos, real upcoming
// appearances, real product prices. `demo` is null when that business is
// missing/unpublished/unreachable (see the fetch's own note) — in that
// case every slide falls back to the original illustrative markup rather
// than rendering a broken half-real card.
//
// Live-QA finishing pass: every slide now packs in as much real content
// as the phone can hold (3 appearances instead of 2, real category names
// instead of just one, a real mini discovery card on slide 4) — the
// earlier version was directionally right but still read as sparse/demo-
// ish in a few spots. Phone got bigger, spacing tightened throughout
// (caption/pagination/CTA sit closer together) so density goes up without
// the section itself getting taller.
const SLIDES = [
  { id: "profile", caption: "Turn your business into a profile people can actually discover." },
  { id: "appearances", caption: "Show customers exactly where to find you next." },
  { id: "products", caption: "Put your products in front of customers before they even arrive." },
  { id: "discovery", caption: "Be discovered while people are deciding what to do, where to go, and what to buy." },
] as const;

export default function BusinessShowcaseCarousel({ demo }: { demo: ShowcaseBusinessData | null }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  function handleScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const slideWidth = el.clientWidth;
    setActive(Math.round(el.scrollLeft / slideWidth));
  }

  function goTo(index: number) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ left: index * el.clientWidth, behavior: "smooth" });
  }

  return (
    <div>
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="flex snap-x snap-mandatory overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {SLIDES.map((slide) => (
          <div key={slide.id} className="w-full shrink-0 snap-center px-1">
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-7">
              <PhoneFrame>{renderScreen(slide.id, demo)}</PhoneFrame>
              <p className="max-w-[240px] text-center text-sm font-medium text-ink/70 sm:max-w-xs sm:text-left sm:text-base">
                {slide.caption}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-center gap-1.5">
        {SLIDES.map((slide, i) => (
          <button
            key={slide.id}
            type="button"
            aria-label={`Go to slide ${i + 1}`}
            onClick={() => goTo(i)}
            className={`h-1.5 rounded-full transition-all ${i === active ? "w-5 bg-findmi" : "w-1.5 bg-black/15"}`}
          />
        ))}
      </div>
    </div>
  );
}

function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative h-64 w-36 shrink-0 rounded-[1.75rem] border-[6px] border-ink bg-ink shadow-lg sm:h-72 sm:w-40">
      <div className="absolute left-1/2 top-1.5 z-10 h-1 w-8 -translate-x-1/2 rounded-full bg-black/40" />
      <div className="h-full w-full overflow-hidden rounded-[1.25rem] bg-white">{children}</div>
    </div>
  );
}

function renderScreen(id: (typeof SLIDES)[number]["id"], demo: ShowcaseBusinessData | null) {
  if (demo) {
    switch (id) {
      case "profile":
        return <RealProfileScreen demo={demo} />;
      case "appearances":
        return <RealAppearancesScreen demo={demo} />;
      case "products":
        return <RealProductsScreen demo={demo} />;
      case "discovery":
        return <RealDiscoveryScreen demo={demo} />;
    }
  }
  return <IllustrativeScreen id={id} />;
}

function RealProfileScreen({ demo }: { demo: ShowcaseBusinessData }) {
  const { business } = demo;
  // Real categories, plural where the business actually has more than
  // one (Native Rose has two) — never padded out with an invented second
  // one when there's only one.
  const categoryNames = business.categories.map((c) => c.name).slice(0, 2).join(" · ");
  const meta = [categoryNames, cityState(business.city, business.state)].filter(Boolean).join(" · ");
  // Real gallery filler — cover photo + real product photos, never a
  // placeholder image.
  const gallery = [business.cover_image_url, ...demo.products.map((p) => p.image_url)]
    .filter((src): src is string => Boolean(src))
    .slice(0, 3);

  return (
    <div className="flex h-full flex-col">
      <div className="relative h-16 shrink-0 bg-gradient-to-br from-findmi-300 to-findmi-600">
        {business.cover_image_url && (
          <Image src={business.cover_image_url} alt="" fill sizes="144px" className="object-cover opacity-70" />
        )}
      </div>
      <div className="flex flex-1 flex-col items-center gap-1 px-2 pt-2">
        <div className="relative -mt-7 h-11 w-11 shrink-0 overflow-hidden rounded-full border-2 border-white bg-white">
          {business.logo_url ? (
            <Image src={business.logo_url} alt="" fill sizes="44px" className="object-cover" />
          ) : (
            <div className="h-full w-full bg-findmi-100" />
          )}
        </div>
        <p className="line-clamp-1 text-[10px] font-bold text-ink">{business.name}</p>
        {meta && <p className="line-clamp-1 text-[7px] text-ink/45">{meta}</p>}
        <span className="mt-1 rounded-full bg-findmi px-3 py-1 text-[7px] font-bold uppercase text-white">
          Follow
        </span>
        <div className="mt-1.5 grid w-full grid-cols-3 gap-1 px-1">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="relative aspect-square overflow-hidden rounded-sm bg-mist">
              {gallery[i] && <Image src={gallery[i]} alt="" fill sizes="40px" className="object-cover" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RealAppearancesScreen({ demo }: { demo: ShowcaseBusinessData }) {
  const upcoming = demo.appearances.slice(0, 3);
  return (
    <div className="flex h-full flex-col gap-1.5 p-2">
      <p className="px-0.5 text-[8px] font-bold uppercase tracking-wide text-ink/40">Upcoming</p>
      {upcoming.length === 0 ? (
        <p className="px-0.5 text-[7px] text-ink/40">No upcoming appearances yet.</p>
      ) : (
        <div className="flex flex-1 flex-col gap-1.5">
          {upcoming.map((a) => (
            <div key={a.id} className="flex items-center gap-1.5 rounded-md border border-black/5 p-1.5">
              <div className="flex h-8 w-8 shrink-0 flex-col items-center justify-center rounded bg-findmi-50">
                <span className="text-[6px] font-bold uppercase text-findmi-700">{formatDateShort(a.start_at).slice(0, 3)}</span>
              </div>
              <div className="min-w-0">
                <p className="truncate text-[7.5px] font-semibold text-ink">{a.venue_name ?? a.title}</p>
                <p className="truncate text-[6.5px] text-ink/45">{formatDateShort(a.start_at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-auto rounded-md bg-ink py-1.5 text-center text-[7px] font-bold uppercase text-white">
        FindMi Here
      </div>
    </div>
  );
}

function RealProductsScreen({ demo }: { demo: ShowcaseBusinessData }) {
  // Prefer products with a real photo — a product with no image would
  // otherwise be just as likely to land in the two slots shown here as
  // one with a real photo, which is the dead-gray-box problem this
  // avoids.
  const withImages = demo.products.filter((p) => p.image_url);
  const withoutImages = demo.products.filter((p) => !p.image_url);
  const products = [...withImages, ...withoutImages].slice(0, 2);

  return (
    <div className="flex h-full flex-col gap-1.5 p-2">
      <p className="px-0.5 text-[8px] font-bold uppercase tracking-wide text-ink/40">Shop</p>
      {products.length === 0 ? (
        <p className="px-0.5 text-[7px] text-ink/40">No products yet.</p>
      ) : products.length === 1 ? (
        // A single product gets a larger card rather than a 2-col grid
        // with one dead empty cell.
        <ProductTile product={products[0]} className="flex-1" imageSizes="128px" />
      ) : (
        <div className="grid flex-1 grid-cols-2 gap-1.5">
          {products.map((p) => (
            <ProductTile key={p.id} product={p} imageSizes="60px" />
          ))}
        </div>
      )}
      <div className="mt-auto rounded-md bg-findmi py-1.5 text-center text-[7px] font-bold uppercase text-white">
        Shop Now
      </div>
    </div>
  );
}

function ProductTile({
  product,
  className,
  imageSizes,
}: {
  product: ShowcaseBusinessData["products"][number];
  className?: string;
  imageSizes: string;
}) {
  const price = product.price != null ? formatCurrency(product.price) : (product.price_label ?? "");
  return (
    <div className={`overflow-hidden rounded-md border border-black/5 ${className ?? ""}`}>
      <div className="relative aspect-square bg-mist">
        {product.image_url && <Image src={product.image_url} alt="" fill sizes={imageSizes} className="object-cover" />}
      </div>
      <div className="px-1 py-1">
        <p className="truncate text-[6.5px] font-medium text-ink/70">{product.name}</p>
        {price && <p className="truncate text-[7px] font-bold text-ink">{price}</p>}
      </div>
    </div>
  );
}

function RealDiscoveryScreen({ demo }: { demo: ShowcaseBusinessData }) {
  const { business } = demo;
  const category = business.categories[0]?.name;
  const nextAppearance = demo.appearances[0] ?? null;

  return (
    <div className="flex h-full flex-col gap-1.5 p-2">
      <div className="flex items-center gap-1 rounded-full border border-black/10 px-1.5 py-1">
        <SearchGlyph className="h-2 w-2 shrink-0 text-ink/35" />
        <span className="truncate text-[6px] text-ink/40">{category ?? "Search FindMi"}</span>
      </div>
      {category && (
        <div className="flex gap-1">
          <span className="shrink-0 rounded-full bg-findmi px-1.5 py-0.5 text-[6px] font-bold uppercase text-white">
            {category}
          </span>
        </div>
      )}
      {/* A real mini discovery-result card for the business itself — the
          concrete "here's what being found looks like" moment. */}
      <div className="relative mt-0.5 flex-1 overflow-hidden rounded-md border border-black/5 bg-mist">
        {business.cover_image_url && (
          <Image src={business.cover_image_url} alt="" fill sizes="128px" className="object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
        {business.logo_url && (
          <div className="absolute bottom-1 left-1 h-6 w-6 overflow-hidden rounded border-2 border-white bg-white">
            <Image src={business.logo_url} alt="" fill sizes="24px" className="object-contain p-0.5" />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-1 pl-8 pr-1.5">
          <p className="truncate text-[7.5px] font-bold text-white">{business.name}</p>
          {nextAppearance && (
            <p className="truncate text-[6px] text-white/85">Next: {formatDateShort(nextAppearance.start_at)}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function SearchGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="2.2" />
      <path d="M20 20l-4.5-4.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

// --- Illustrative fallback — used only when the real demo business can't
// be resolved (see getShowcaseBusiness's own note), so the showcase never
// renders broken/partial real data. ---
function IllustrativeScreen({ id }: { id: (typeof SLIDES)[number]["id"] }) {
  switch (id) {
    case "profile":
      return (
        <div className="flex h-full flex-col">
          <div className="h-16 shrink-0 bg-gradient-to-br from-findmi-300 to-findmi-600" />
          <div className="flex flex-1 flex-col items-center gap-1 px-2 pt-2">
            <div className="-mt-7 h-11 w-11 shrink-0 rounded-full border-2 border-white bg-findmi-100" />
            <p className="text-[10px] font-bold text-ink">Your Business Name</p>
            <p className="text-[7px] text-ink/45">Makers &amp; Goods · Your City</p>
            <span className="mt-1 rounded-full bg-findmi px-3 py-1 text-[7px] font-bold uppercase text-white">
              Follow
            </span>
            <div className="mt-1.5 grid w-full grid-cols-3 gap-1 px-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="aspect-square rounded-sm bg-mist" />
              ))}
            </div>
          </div>
        </div>
      );
    case "appearances":
      return (
        <div className="flex h-full flex-col gap-1.5 p-2">
          <p className="px-0.5 text-[8px] font-bold uppercase tracking-wide text-ink/40">Upcoming</p>
          {[
            { d: "SAT", t: "Saturday Market" },
            { d: "SUN", t: "Pop-Up at 5th St" },
            { d: "FRI", t: "Downtown Night Market" },
          ].map((row) => (
            <div key={row.t} className="flex items-center gap-1.5 rounded-md border border-black/5 p-1.5">
              <div className="flex h-8 w-8 shrink-0 flex-col items-center justify-center rounded bg-findmi-50">
                <span className="text-[6px] font-bold uppercase text-findmi-700">{row.d}</span>
              </div>
              <div className="min-w-0">
                <p className="truncate text-[7.5px] font-semibold text-ink">{row.t}</p>
                <p className="truncate text-[6.5px] text-ink/45">Downtown</p>
              </div>
            </div>
          ))}
          <div className="mt-auto rounded-md bg-ink py-1.5 text-center text-[7px] font-bold uppercase text-white">
            + Add Event
          </div>
        </div>
      );
    case "products":
      return (
        <div className="flex h-full flex-col gap-1.5 p-2">
          <p className="px-0.5 text-[8px] font-bold uppercase tracking-wide text-ink/40">Shop</p>
          <div className="grid flex-1 grid-cols-2 gap-1.5">
            {["$28", "$45"].map((price) => (
              <div key={price} className="overflow-hidden rounded-md border border-black/5">
                <div className="aspect-square bg-mist" />
                <div className="px-1 py-1">
                  <p className="text-[7px] font-bold text-ink">{price}.00</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-auto rounded-md bg-findmi py-1.5 text-center text-[7px] font-bold uppercase text-white">
            Shop Now
          </div>
        </div>
      );
    case "discovery":
      return (
        <div className="flex h-full flex-col gap-1.5 p-2">
          <div className="flex items-center gap-1 rounded-full border border-black/10 px-1.5 py-1">
            <SearchGlyph className="h-2 w-2 shrink-0 text-ink/35" />
            <span className="truncate text-[6px] text-ink/40">Search FindMi</span>
          </div>
          <div className="flex gap-1">
            <span className="shrink-0 rounded-full bg-findmi px-1.5 py-0.5 text-[6px] font-bold uppercase text-white">
              Makers &amp; Goods
            </span>
          </div>
          <div className="mt-0.5 flex flex-1 items-center justify-center rounded-md bg-findmi-50">
            <span className="text-[7px] font-bold uppercase tracking-wide text-findmi-700">You&rsquo;re Found</span>
          </div>
        </div>
      );
  }
}
