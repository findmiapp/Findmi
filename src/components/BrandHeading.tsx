import type { ReactNode } from "react";

/** Findmi product-signature heading — "Findmi" in primary type with an Aqua
 * accent word, the same treatment as the "Findmi Admin" shell identity.
 * Use sparingly for genuine Findmi concepts (Findmi Moments, Findmi Here,
 * Findmi Pro …) — never for entity names, ordinary section headings or
 * buttons. Brand casing is always "Findmi". */
export default function BrandHeading({
  accent,
  as: Tag = "h2",
  id,
  className = "",
  trailing,
  size = "default",
}: {
  accent: string;
  as?: "h1" | "h2" | "h3";
  id?: string;
  className?: string;
  /** Optional right-aligned slot (e.g. a "See all" link). */
  trailing?: ReactNode;
  /** "home": the homepage's peer section-title scale (text-2xl / sm:text-3xl,
   * same as HOMEPAGE_SECTION_TITLE_CLASS) — same treatment, larger size. */
  size?: "default" | "home";
}) {
  const sizeClass = size === "home" ? "text-2xl tracking-tight sm:text-3xl" : "text-section-title-lg sm:text-page-title";
  const heading = (
    <Tag id={id} className={`font-display font-bold text-primary ${sizeClass} ${trailing ? "" : className}`}>
      Findmi <span className="text-findmi-600">{accent}</span>
    </Tag>
  );
  if (!trailing) return heading;
  return (
    <div className={`flex items-baseline justify-between gap-3 ${className}`}>
      {heading}
      <div className="shrink-0">{trailing}</div>
    </div>
  );
}
