export type ChevronDirection = "right" | "left" | "down" | "up";

const ROTATION: Record<ChevronDirection, string> = {
  down: "",
  up: "rotate-180",
  right: "-rotate-90",
  left: "rotate-90",
};

/** Global UI Consistency Pass — the ONE shared chevron primitive for
 * every directional navigation/disclosure affordance in the app
 * (forward links, back links, "view more", open/close toggles).
 * Replaces typed arrow characters (→ ← › ‹) used as UI chrome, and the
 * several near-identical local `ChevronGlyph` copies that had
 * accumulated per-file — same base path every one of those already
 * used, rotated per direction rather than redrawn. Decorative by
 * default: the adjacent label already names the destination/action, so
 * this never needs its own accessible name (pass `aria-hidden={false}`
 * only on the rare case where no adjacent text exists). */
export default function ChevronIcon({
  direction = "right",
  className,
  "aria-hidden": ariaHidden = true,
}: {
  direction?: ChevronDirection;
  className?: string;
  "aria-hidden"?: boolean;
}) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden={ariaHidden} className={`${ROTATION[direction]} ${className ?? ""}`}>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
