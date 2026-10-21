import OptimisticTabs from "./OptimisticTabs";
import { GROWTH_DESTINATIONS, GROWTH_DESTINATION_LABELS, growthHref, type GrowthDestination } from "@/lib/growth";

/** The persistent Growth navigation — Goals · Opportunities · Ideas — shown
 * on every Growth page (the hub views, Growth Setup, the goal wizard), so no
 * Growth page is ever a dead end: from any of the three you reach the other
 * two in one tap. `badges` are real counts passed by pages that already have
 * them; omitted otherwise. The highlight moves on tap (OptimisticTabs). */
export default function GrowthNav({
  basePath,
  active,
  badges,
}: {
  basePath: string;
  active: GrowthDestination;
  badges?: Partial<Record<GrowthDestination, number>>;
}) {
  return (
    <OptimisticTabs
      ariaLabel="Growth"
      navClass="grid grid-cols-3 gap-0.5 rounded-full bg-black/[0.04] p-0.5"
      linkClass="flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-full px-2 text-button font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
      activeClass="bg-white text-primary shadow-sm"
      inactiveClass="text-muted hover:text-primary"
      badgeClass="inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-bold leading-[18px]"
      badgeActiveClass="bg-findmi text-white"
      badgeInactiveClass="bg-findmi-50 text-findmi-700"
      active={active}
      items={GROWTH_DESTINATIONS.map((d) => ({
        key: d,
        href: growthHref(basePath, d),
        label: <span className="truncate">{GROWTH_DESTINATION_LABELS[d]}</span>,
        badge: badges?.[d],
      }))}
    />
  );
}
