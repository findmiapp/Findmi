import Link from "next/link";
import NavIcon from "./NavIcon";

/** Homepage Map entry — sits directly left of the homepage Search field and
 * links straight to /map (no modal, menu, geolocation or embedded map).
 * True-black pill, no border, same radius as Search; the shared nav "pin"
 * icon in Findmi Aqua, then a white "MAP" label. Behind them, three faint
 * street paths (white ~13% opacity, 1px) — decoration only, aria-hidden. */
export default function HomeMapButton() {
  return (
    <Link
      href="/map"
      aria-label="Map"
      className="relative flex w-[23%] min-w-[5rem] max-w-[8.5rem] shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full bg-[#000000] text-white transition active:scale-[0.98] sm:w-36 sm:max-w-none"
    >
      <svg aria-hidden="true" viewBox="0 0 120 50" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" fill="none">
        <g stroke="rgba(255,255,255,0.13)" strokeWidth="1" vectorEffect="non-scaling-stroke">
          <path d="M-2 33 C 26 30, 46 36, 72 31 S 106 24, 122 27" vectorEffect="non-scaling-stroke" />
          <path d="M44 -2 C 41 12, 47 22, 45 34" vectorEffect="non-scaling-stroke" />
          <path d="M88 52 C 90 42, 86 36, 91 29" vectorEffect="non-scaling-stroke" />
        </g>
      </svg>
      <NavIcon name="pin" className="relative h-[18px] w-[18px] shrink-0 text-findmi" />
      <span className="relative whitespace-nowrap text-sm font-semibold leading-none tracking-wide sm:text-[15px]">MAP</span>
    </Link>
  );
}
