import Link from "next/link";

/** Listings / Business Goals / Ideas switch at the top of Admin Opportunities. */
export default function OpportunitiesAdminTabs({ active }: { active: "listings" | "goals" | "ideas" }) {
  const tab = (key: "listings" | "goals" | "ideas", href: string, label: string) => (
    <Link
      href={href}
      aria-current={active === key ? "page" : undefined}
      className={`border-b-2 pb-2 text-sm font-semibold transition ${active === key ? "border-ink text-ink" : "border-transparent text-ink/45 hover:text-ink"}`}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Opportunities sections" className="mt-5 flex gap-5 border-b border-black/5">
      {tab("listings", "/admin/opportunities", "Listings")}
      {tab("goals", "/admin/opportunities/goals", "Business Goals")}
      {tab("ideas", "/admin/opportunities/ideas", "Ideas")}
    </nav>
  );
}
