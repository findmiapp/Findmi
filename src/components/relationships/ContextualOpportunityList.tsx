import Link from "next/link";
import type { ContextualOpportunity } from "@/lib/relationship-context";
import { RELATIONSHIP_ACTIONS } from "@/lib/relationship-links";

/** Opportunities about one exact entity, from the ONE Opportunity system —
 * each opens its existing page (Explore Opportunity), never an Inquiry. */
export default function ContextualOpportunityList({ items }: { items: readonly ContextualOpportunity[] }) {
  return (
    <ul className="flex flex-col divide-y divide-black/[0.06] rounded-xl border border-black/[0.08] bg-white">
      {items.map((o) => (
        <li key={o.path} className="flex flex-col gap-1 px-3.5 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-3">
          <span className="min-w-0 sm:flex-1">
            <span className="line-clamp-2 block text-body font-semibold text-primary">{o.title}</span>
            <span className="block truncate text-metadata text-muted">{[o.typeLabel, o.reason, o.sentToYou ? "Sent to You" : null].filter(Boolean).join(" · ")}</span>
          </span>
          <Link href={o.path} className="flex min-h-10 shrink-0 items-center self-start text-metadata font-semibold text-accent hover:underline sm:self-auto">
            {RELATIONSHIP_ACTIONS.opportunity}
          </Link>
        </li>
      ))}
    </ul>
  );
}
