import NavIcon from "@/components/NavIcon";
import { MomentGlyph } from "@/components/opportunities/OpportunityGlyphs";
import type { BusinessCreateIcon } from "./createActions";

/** The Findmi icon for a Business creation action — NavIcon for presence /
 * Event / Location / Product, plus the established Moment pencil and QR
 * mark. One mapping, used by Business Home, the "+" sheet and the More
 * menu, so the same action always carries the same icon. No hooks: safe
 * in server and client components. */
export default function CreateActionIcon({ icon, className = "h-5 w-5" }: { icon: BusinessCreateIcon; className?: string }) {
  if (icon === "qr") return <QrGlyph className={className} />;
  if (icon === "moment") return <MomentGlyph className={className} />;
  return <NavIcon name={icon} className={className} />;
}

/** 24px / 1.8-stroke family, same as NavIcon. */
export function QrGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="4" y="4" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.8" />
      <rect x="14" y="4" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.8" />
      <rect x="4" y="14" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.8" />
      <path d="M14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5z" fill="currentColor" />
    </svg>
  );
}
