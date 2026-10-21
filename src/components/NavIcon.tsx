import type { NavIconKey } from "@/lib/navigation";

// The curated icon set a founder can attach to a nav item (see
// lib/navigation.ts's NAV_ICON_KEYS — the admin picker and this renderer
// share that same list, so a saved key always resolves to a real icon).
// Same 24x24 stroke style as every other icon in the app (NavMobile,
// PostCard, ProductCard, etc.) for visual consistency.
export default function NavIcon({ name, className }: { name: NavIconKey; className?: string }) {
  switch (name) {
    case "compass":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
          <path d="M15 9l-4.5 1.5L9 15l4.5-1.5L15 9z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      );
    case "pin":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <path
            d="M12 21s7-6.2 7-11.5A7 7 0 105 9.5C5 14.8 12 21 12 21z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="9.5" r="2.2" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "target":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="12" cy="12" r="2.5" fill="currentColor" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "bookmark":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <path
            d="M6 4h12a1 1 0 011 1v15l-7-4-7 4V5a1 1 0 011-1z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "person":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M4.5 20c1.3-3.5 4.3-5.5 7.5-5.5s6.2 2 7.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "tag":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <path
            d="M11.5 4H5a1 1 0 00-1 1v6.5a1 1 0 00.3.7l9 9a1 1 0 001.4 0l6.5-6.5a1 1 0 000-1.4l-9-9a1 1 0 00-.7-.3z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <circle cx="8.2" cy="8.2" r="1.3" fill="currentColor" />
        </svg>
      );
    case "calendar":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <rect x="3.5" y="5" width="17" height="15.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "storefront":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          {/* Brand / Business — awning band over a shopfront with a door. */}
          <rect x="3.5" y="4" width="17" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M9.2 4v5.5M14.8 4v5.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M5 9.5V19a1.5 1.5 0 001.5 1.5h11A1.5 1.5 0 0019 19V9.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M10 20.5V16a1 1 0 011-1h2a1 1 0 011 1v4.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      );
    case "findmi":
      // Findmi Here — the brand mark's sprout/leaf (two petals under an arc),
      // not a map pin: Findmi Here is where a brand shows up and can be found,
      // broader than "Locations". Same glyph wherever Findmi Here appears.
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <path d="M8.2 5.2c2.3-1.3 5.3-1.3 7.6 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M12 21v-7.2C12 10.4 9.6 8 5.8 8c0 3.8 2 6 6.2 5.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12 13.8c4.2.2 6.2-2 6.2-5.8C14.4 8 12 10.4 12 13.8z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "moments":
      // Moments — a photo (Moments are captured experiences). Distinct
      // from "target", which also means Performance / Analytics.
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <rect x="3.5" y="5" width="17" height="14.5" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M3.5 16.5l4.6-4.2a1.2 1.2 0 011.6 0l3.3 3 2.2-2a1.2 1.2 0 011.6 0l3.7 3.4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <circle cx="15.5" cy="9.6" r="1.6" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    case "home":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <path d="M4 11l8-7 8 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M6 9.5V20a1 1 0 001 1h10a1 1 0 001-1V9.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      );
    case "cart":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className}>
          <path
            d="M4 6h2l1.2 10.4A2 2 0 009.2 18h7.6a2 2 0 002-1.7L20 8H7"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="10" cy="21" r="1.4" fill="currentColor" />
          <circle cx="17" cy="21" r="1.4" fill="currentColor" />
        </svg>
      );
  }
}
