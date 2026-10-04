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
}: {
  accent: string;
  as?: "h1" | "h2" | "h3";
  id?: string;
  className?: string;
  /** Optional right-aligned slot (e.g. a "See all" link). */
  trailing?: ReactNode;
}) {
  const heading = (
    <Tag id={id} className={`font-display text-section-title-lg font-bold text-primary sm:text-page-title ${trailing ? "" : className}`}>
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
