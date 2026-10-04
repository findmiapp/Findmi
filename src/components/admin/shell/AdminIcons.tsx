import NavIcon from "@/components/NavIcon";
import type { AdminSectionKey } from "../adminNavItems";

/** Admin V2 — section glyphs, same 24px / 1.8-stroke family as NavIcon and
 * the /account V2 shell. Reuses NavIcon where an existing glyph already
 * says the right thing. */
export function AdminSectionIcon({ section, className }: { section: AdminSectionKey; className?: string }) {
  switch (section) {
    case "home":
      return <NavIcon name="home" className={className} />;
    case "directory":
      return <NavIcon name="storefront" className={className} />;
    case "activity":
      return <NavIcon name="calendar" className={className} />;
    case "requests":
      return <InboxGlyph className={className} />;
    case "more":
      return <GridGlyph className={className} />;
  }
}

export function InboxGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M4 13l2.5-7.5h11L20 13v5a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 18v-5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M4 13h4.5l1.5 2.5h4l1.5-2.5H20" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

export function GridGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.8" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8" stroke="currentColor" strokeWidth="1.8" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function ChevronRightGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronLeftGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ExternalGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M14 5h5v5M19 5l-8 8M17 14v4.5a1.5 1.5 0 01-1.5 1.5h-10A1.5 1.5 0 014 18.5v-10A1.5 1.5 0 015.5 7H10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
