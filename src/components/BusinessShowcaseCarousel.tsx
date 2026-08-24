"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import type { ShowcaseBusinessData } from "@/lib/data";
import { cityState, formatCurrency, formatDateShort } from "@/lib/format";

// Compact swipeable business-acquisition showcase — native CSS scroll-snap
// (no carousel library) so it's touch-native and lightweight. Reworked in
// the live-QA nav pass (Part 14/15) to demonstrate with FindMi's own real
// data (The Native Rose — see lib/data.ts's getShowcaseBusiness) instead
// of an entirely illustrative mockup: real logo/cover/product photos,
// real upcoming appearances, real product prices. `demo` is null when
// that business is missing/unpublished/unreachable (see the fetch's own
// note) — in that case every slide falls back to the original
// illustrative markup rather than rendering a broken half-real card.
const SLIDES = [
  { id: "profile", caption: "A profile built for discovery." },
  { id: "appearances", caption: "Show customers where to find you next." },
  { id: "products", caption: "Put your products in front of local customers." },
  { id: "discovery", caption: "Be found when people are deciding where to go and what to buy." },
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
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-8">
              <PhoneFrame>{renderScreen(slide.id, demo)}</PhoneFrame>
              <p className="max-w-[220px] text-center text-sm font-medium text-ink/70 sm:max-w-xs sm:text-left sm:text-base">
                {slide.caption}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-center gap-1.5">
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
    <div className="relative h-56 w-32 shrink-0 rounded-[1.75rem] border-[6px] border-ink bg-ink shadow-lg sm:h-64 sm:w-36">
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
        return <DiscoveryScreen businessName={demo.business.name} />;
    }
  }
  return <IllustrativeScreen id={id} />;
}

function RealProfileScreen({ demo }: { demo: ShowcaseBusinessData }) {
  const { business } = demo;
  const meta = [business.categories[0]?.name, cityState(business.city, business.state)].filter(Boolean).join(" · ");
  // Real gallery filler — cover photo + up to two real product photos,
  // never a placeholder image.
  const gallery = [business.cover_image_url, ...demo.products.map((p) => p.image_url)]
    .filter((src): src is string => Boolean(src))
    .slice(0, 3);

  return (
    <div className="flex h-full flex-col">
      <div className="relative h-14 shrink-0 bg-gradient-to-br from-findmi-300 to-findmi-600">
        {business.cover_image_url && (
          <Image src={business.cover_image_url} alt="" fill sizes="128px" className="object-cover opacity-70" />
        )}
      </div>
      <div className="flex flex-1 flex-col items-center gap-1 px-2 pt-2">
        <div className="relative -mt-6 h-9 w-9 shrink-0 overflow-hidden rounded-full border-2 border-white bg-white">
          {business.logo_url ? (
            <Image src={business.logo_url} alt="" fill sizes="36px" className="object-cover" />
          ) : (
            <div className="h-full w-full bg-findmi-100" />
          )}
        </div>
        <p className="line-clamp-1 text-[9px] font-bold text-ink">{business.name}</p>
        {meta && <p className="line-clamp-1 text-[7px] text-ink/45">{meta}</p>}
        <span className="mt-1 rounded-full bg-findmi px-2.5 py-1 text-[7px] font-bold uppercase text-white">
          Follow
        </span>
        <div className="mt-1.5 grid w-full grid-cols-3 gap-1 px-1">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="relative aspect-square overflow-hidden rounded-sm bg-mist">
              {gallery[i] && <Image src={gallery[i]} alt="" fill sizes="32px" className="object-cover" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RealAppearancesScreen({ demo }: { demo: ShowcaseBusinessData }) {
  const upcoming = demo.appearances.slice(0, 2);
  return (
    <div className="flex h-full flex-col gap-1.5 p-2">
      <p className="px-0.5 text-[8px] font-bold uppercase tracking-wide text-ink/40">Upcoming</p>
      {upcoming.length === 0 ? (
        <p className="px-0.5 text-[7px] text-ink/40">No upcoming appearances yet.</p>
      ) : (
        upcoming.map((a) => (
          <div key={a.id} className="flex items-center gap-1.5 rounded-md border border-black/5 p-1">
            <div className="flex h-7 w-7 shrink-0 flex-col items-center justify-center rounded bg-findmi-50">
              <span className="text-[6px] font-bold uppercase text-findmi-700">{formatDateShort(a.start_at).slice(0, 3)}</span>
            </div>
            <div className="min-w-0">
              <p className="truncate text-[7px] font-semibold text-ink">{a.venue_name ?? a.title}</p>
              <p className="truncate text-[6px] text-ink/45">{formatDateShort(a.start_at)}</p>
            </div>
          </div>
        ))
      )}
      <div className="mt-auto rounded-md bg-ink py-1 text-center text-[7px] font-bold uppercase text-white">
        FindMi Here
      </div>
    </div>
  );
}

function RealProductsScreen({ demo }: { demo: ShowcaseBusinessData }) {
  const products = demo.products.slice(0, 2);
  return (
    <div className="flex h-full flex-col gap-1.5 p-2">
      <p className="px-0.5 text-[8px] font-bold uppercase tracking-wide text-ink/40">Shop</p>
      {products.length === 0 ? (
        <p className="px-0.5 text-[7px] text-ink/40">No products yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {products.map((p) => (
            <div key={p.id} className="overflow-hidden rounded-md border border-black/5">
              <div className="relative aspect-square bg-mist">
                {p.image_url && <Image src={p.image_url} alt="" fill sizes="60px" className="object-cover" />}
              </div>
              <div className="px-1 py-0.5">
                <p className="truncate text-[6px] font-semibold text-ink/70">
                  {p.price != null ? formatCurrency(p.price) : (p.price_label ?? "")}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DiscoveryScreen({ businessName }: { businessName?: string }) {
  return (
    <div className="flex h-full flex-col gap-1.5 p-2">
      <div className="flex items-center gap-1 rounded-full border border-black/10 px-1.5 py-1">
        <div className="h-2 w-2 rounded-full border border-ink/30" />
        <div className="h-1 flex-1 rounded-full bg-black/5" />
      </div>
      <div className="flex gap-1">
        {["Food", "Makers", "Events"].map((c) => (
          <span key={c} className="shrink-0 rounded-full border border-black/10 px-1.5 py-0.5 text-[6px] text-ink/60">
            {c}
          </span>
        ))}
      </div>
      <div className="mt-0.5 flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md bg-findmi-50 px-1 text-center">
        <span className="text-[7px] font-bold uppercase tracking-wide text-findmi-700">You&rsquo;re Found</span>
        {businessName && <span className="line-clamp-1 text-[6px] text-findmi-700/70">{businessName}</span>}
      </div>
    </div>
  );
}

// --- Illustrative fallback (unchanged from the original pass) — used
// only when the real demo business can't be resolved (see the fetch's
// own note), so the showcase never renders broken/partial real data. ---
function IllustrativeScreen({ id }: { id: (typeof SLIDES)[number]["id"] }) {
  switch (id) {
    case "profile":
      return (
        <div className="flex h-full flex-col">
          <div className="h-14 shrink-0 bg-gradient-to-br from-findmi-300 to-findmi-600" />
          <div className="flex flex-1 flex-col items-center gap-1 px-2 pt-2">
            <div className="-mt-6 h-9 w-9 shrink-0 rounded-full border-2 border-white bg-findmi-100" />
            <p className="text-[9px] font-bold text-ink">Your Business Name</p>
            <p className="text-[7px] text-ink/45">Makers &amp; Goods · Your City</p>
            <span className="mt-1 rounded-full bg-findmi px-2.5 py-1 text-[7px] font-bold uppercase text-white">
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
          ].map((row) => (
            <div key={row.t} className="flex items-center gap-1.5 rounded-md border border-black/5 p-1">
              <div className="flex h-7 w-7 shrink-0 flex-col items-center justify-center rounded bg-findmi-50">
                <span className="text-[6px] font-bold uppercase text-findmi-700">{row.d}</span>
              </div>
              <div className="min-w-0">
                <p className="truncate text-[7px] font-semibold text-ink">{row.t}</p>
                <p className="truncate text-[6px] text-ink/45">Downtown</p>
              </div>
            </div>
          ))}
          <div className="mt-auto rounded-md bg-ink py-1 text-center text-[7px] font-bold uppercase text-white">
            + Add Event
          </div>
        </div>
      );
    case "products":
      return (
        <div className="flex h-full flex-col gap-1.5 p-2">
          <p className="px-0.5 text-[8px] font-bold uppercase tracking-wide text-ink/40">Shop</p>
          <div className="grid grid-cols-2 gap-1.5">
            {["$28", "$45"].map((price) => (
              <div key={price} className="overflow-hidden rounded-md border border-black/5">
                <div className="aspect-square bg-mist" />
                <div className="px-1 py-0.5">
                  <p className="text-[6px] font-semibold text-ink/70">{price}.00</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    case "discovery":
      return <DiscoveryScreen />;
  }
}
