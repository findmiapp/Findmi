import Link from "next/link";
import ChevronIcon from "@/components/ChevronIcon";
import { managerHref, withOrigin } from "@/lib/manager-links";

/** Findmi Here → Places: a compact bridge from WHERE WE ARE (Find Us Here /
 * Our Locations — current presence) to WHERE WE WANT TO GROW (Growth).
 * Targets are private commercial intent and live in Growth, their canonical
 * owner; this only deep-links there — no Target data is read or duplicated
 * here. Each link carries the active Business and a validated origin. */
export default function GrowthFootprintBridge({ businessId }: { businessId: string }) {
  const links: { label: string; href: string }[] = [
    { label: "Add Target", href: withOrigin(managerHref(businessId, "add-target"), "findmi-here") },
    { label: "Discover", href: withOrigin(managerHref(businessId, "discover"), "findmi-here") },
    { label: "Opportunities", href: managerHref(businessId, "opportunities") },
  ];
  return (
    <section aria-labelledby="grow-footprint-title" className="mt-6 rounded-2xl border border-findmi-100 bg-findmi-50/50 px-4 py-3.5">
      <h2 id="grow-footprint-title" className="text-card-title font-bold text-primary">
        Want To Grow Your Footprint?
      </h2>
      <p className="mt-0.5 text-metadata text-muted">Add places you&rsquo;re pursuing, discover potential partners and explore Opportunities that can help you get there.</p>
      <ul className="mt-2.5 flex flex-wrap gap-1.5">
        {links.map((l) => (
          <li key={l.label}>
            <Link
              href={l.href}
              className="flex h-8 items-center gap-1 rounded-full border border-findmi-200 bg-white px-3 text-metadata font-bold text-findmi-700 transition hover:border-findmi-300 hover:bg-findmi-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
            >
              {l.label}
              <ChevronIcon direction="right" className="h-3 w-3" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
