import Image from "next/image";

// Homepage Business Acquisition Section Rebuild pass — replaces the prior
// live-data-driven fake-UI phone mockup entirely. This no longer
// simulates Findmi's interface with manufactured HTML/CSS "screens"; it
// shows three ACTUAL screenshots of a real Findmi business profile (The
// Native Rose), in sequence: profile identity -> Findmi Here schedule +
// Gallery -> Gallery + About/contact. Files live at public/seed/
// native-rose-*.jpg — real screenshots with only the phone status bar and
// browser address bar cropped off (Findmi's own app header was kept, for
// authenticity); nothing redrawn, no fake device chrome added, no
// filters applied. A plain horizontally-swipeable peek row (same native
// CSS scroll-snap technique as this homepage's other card rows — Brands
// We Love, Upcoming Events) — no phone-shell wrapper, no per-slide JS
// state/dots: the first screenshot is the dominant visible card, with
// enough of the next one peeking in to read as swipeable.
const SLIDES = [
  {
    id: "profile",
    src: "/seed/native-rose-profile-top.jpg",
    caption: "Your profile",
    alt: "The Native Rose's Findmi profile: cover photo, name, category, location and description",
  },
  {
    id: "schedule",
    src: "/seed/native-rose-findmi-here-gallery.jpg",
    caption: "Show where you'll be",
    alt: "The Native Rose's Findmi Here schedule of upcoming appearances, and the start of its Gallery",
  },
  {
    id: "connect",
    src: "/seed/native-rose-gallery-about.jpg",
    caption: "Give people more ways to connect",
    alt: "The Native Rose's Gallery, About section, and contact details",
  },
] as const;

export default function BusinessShowcaseCarousel() {
  return (
    <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {SLIDES.map((slide) => (
        <div key={slide.id} className="w-[80%] max-w-[280px] shrink-0 snap-center sm:w-72">
          <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl border border-black/10 bg-mist shadow-sm">
            <Image
              src={slide.src}
              alt={slide.alt}
              fill
              sizes="(min-width: 768px) 288px, 80vw"
              className="object-cover object-top"
            />
          </div>
          <p className="mt-2 text-sm font-medium text-ink/70">{slide.caption}</p>
        </div>
      ))}
    </div>
  );
}
