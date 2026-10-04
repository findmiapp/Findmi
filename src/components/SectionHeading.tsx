import type { ReactNode } from "react";

/** Public Entity System V2 — the one shared public section title (Event,
 * Business; Location/Product later). Copy is intentional Title Case written
 * by the caller ("Upcoming Dates", "Findmi Here", "Contact & Links") —
 * never CSS-capitalized. `trailing` sits at the right of the title row
 * (a count, a "See all" link, a view toggle). */
export default function SectionHeading({
  children,
  id,
  as: Tag = "h2",
  className = "",
  trailing,
}: {
  children: ReactNode;
  id?: string;
  as?: "h2" | "h3";
  className?: string;
  trailing?: ReactNode;
}) {
  const heading = (
    <Tag id={id} className={`font-display text-section-title-lg font-bold text-primary ${trailing ? "" : className}`}>
      {children}
    </Tag>
  );
  if (!trailing) return heading;
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      {heading}
      <div className="shrink-0">{trailing}</div>
    </div>
  );
}
