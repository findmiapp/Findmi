import Link from "next/link";
import type { AvailabilityDetail } from "@/lib/business-location-availability";
import { availabilityRelationshipsPhrase, availabilityWhenLabel } from "@/lib/business-availability-domain";

/** The compact "what can I find here" line shown under a Find Us Here card
 * (Business page) and a Brands Available Here entry (Location page): HOW
 * ("Served Here", or "Served, Sold & Stocked Here" when several apply — one place, one line), WHEN only when it isn't ongoing ("Until Dec 31, 2026"),
 * and WHAT — the first products inline, the rest behind a native
 * <details> disclosure. An entry with no detail beyond the default (stocked,
 * Brand-wide, ongoing) renders nothing, so existing connections look exactly
 * as they did. Only Live, in-effect entries ever reach this component (the
 * readers filter), so it never sees Pending Review or Declined data. */
const INLINE_PRODUCTS = 2;

export default function AvailabilityDetailLine({ detail, className = "" }: { detail?: AvailabilityDetail; className?: string }) {
  if (!detail) return null;
  const ongoing = !detail.startsOn && !detail.endsOn;
  const isDefault = detail.relationships.length === 1 && detail.relationships[0] === "stocked" && ongoing && detail.products.length === 0 && !detail.note;
  if (isDefault) return null;
  const shown = detail.products.slice(0, INLINE_PRODUCTS);
  const more = detail.products.slice(INLINE_PRODUCTS);
  return (
    <div className={`text-xs text-ink/60 ${className}`}>
      <p className="flex flex-wrap items-center gap-x-1.5">
        <span className="font-semibold text-findmi-700">{availabilityRelationshipsPhrase(detail.relationships)}</span>
        {!ongoing && <span>· {availabilityWhenLabel(detail.startsOn, detail.endsOn)}</span>}
      </p>
      {detail.products.length > 0 && (
        <p className="mt-0.5">
          {shown.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ", "}
              <Link href={`/product/${p.slug}`} className="font-medium text-ink/75 hover:underline">
                {p.name}
              </Link>
            </span>
          ))}
          {more.length > 0 && (
            <details className="inline">
              <summary className="ml-1 inline cursor-pointer font-semibold text-findmi-700 marker:content-none">+{more.length} more</summary>
              <span className="block pt-0.5">
                {more.map((p, i) => (
                  <span key={p.id}>
                    {i > 0 && ", "}
                    <Link href={`/product/${p.slug}`} className="font-medium text-ink/75 hover:underline">
                      {p.name}
                    </Link>
                  </span>
                ))}
              </span>
            </details>
          )}
        </p>
      )}
      {detail.note && <p className="mt-0.5 text-ink/50">{detail.note}</p>}
    </div>
  );
}
