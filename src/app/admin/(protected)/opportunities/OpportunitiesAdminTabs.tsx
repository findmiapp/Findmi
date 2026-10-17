import Link from "next/link";
import { getIntelligenceSummary } from "@/lib/brand-intelligence";

type Tab = "listings" | "intelligence" | "goals" | "ideas";

/** Listings / Intelligence / Business Goals / Ideas switch at the top of
 * Admin Opportunities. Intelligence carries its New count so new Brand
 * signals are visible from every Opportunities view. */
export default async function OpportunitiesAdminTabs({ active }: { active: Tab }) {
  let newSignals = 0;
  try {
    newSignals = (await getIntelligenceSummary())?.newSignals ?? 0;
  } catch {
    newSignals = 0;
  }
  const tab = (key: Tab, href: string, label: string, badge?: number) => (
    <Link
      href={href}
      aria-current={active === key ? "page" : undefined}
      className={`flex shrink-0 items-center gap-1.5 border-b-2 pb-2 text-sm font-semibold transition ${active === key ? "border-ink text-ink" : "border-transparent text-ink/45 hover:text-ink"}`}
    >
      {label}
      {badge ? <span className="rounded-full bg-findmi px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">{badge} New</span> : null}
    </Link>
  );
  return (
    <nav aria-label="Opportunities sections" className="-mx-4 mt-5 flex gap-5 overflow-x-auto border-b border-black/5 px-4 sm:mx-0 sm:px-0">
      {tab("listings", "/admin/opportunities", "Listings")}
      {tab("intelligence", "/admin/opportunities/intelligence", "Intelligence", newSignals)}
      {tab("goals", "/admin/opportunities/goals", "Business Goals")}
      {tab("ideas", "/admin/opportunities/ideas", "Ideas")}
    </nav>
  );
}
