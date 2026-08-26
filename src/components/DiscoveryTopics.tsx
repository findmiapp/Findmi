import Link from "next/link";
import type { DiscoveryTopic } from "@/lib/site-sections";

/** Compact horizontal navigation row, bridging Search and "Upcoming
 * Events Near You" (Homepage Hero Polish pass). Each chip is a plain link
 * to a real, existing destination — see lib/site-sections.ts's
 * resolveDiscoveryTopics, which already filters out anything without a
 * real URL. This is NOT a cross-content Discovery filter; that
 * architecture doesn't exist yet, so a chip carries no taxonomy meaning
 * beyond "go to this page". Mobile: one horizontal swipe row (compact
 * rounded chips, next chip partially visible); desktop: a clean row that
 * wraps once it runs out of width, never oversized pills. */
export default function DiscoveryTopics({ topics }: { topics: DiscoveryTopic[] }) {
  if (topics.length === 0) return null;

  return (
    <nav aria-label="Discovery topics" className="border-b border-black/5 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {topics.map((topic) => (
            <Link
              key={topic.label}
              href={topic.url}
              className="shrink-0 rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-medium text-ink/70 transition hover:border-findmi/40 hover:bg-findmi-50 hover:text-findmi-700"
            >
              {topic.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
