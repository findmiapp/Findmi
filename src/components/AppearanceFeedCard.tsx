import Image from "next/image";
import Link from "next/link";
import type { AppearanceFeedItem } from "@/lib/data";
import { cityState, formatDateRange } from "@/lib/format";

export default function AppearanceFeedCard({
  item,
}: {
  item: AppearanceFeedItem;
}) {
  if (!item.business) return null;

  return (
    <Link
      href={`/business/${item.business.slug}`}
      className="flex shrink-0 flex-col gap-3 rounded-2xl border border-black/5 bg-white p-4 transition hover:shadow-md hover:shadow-black/5"
    >
      <div className="flex items-center gap-3">
        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-black/5">
          {item.business.logo_url && (
            <Image
              src={item.business.logo_url}
              alt={item.business.name}
              fill
              sizes="40px"
              className="object-cover"
            />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{item.business.name}</p>
          <p className="text-xs text-ink/50">{formatDateRange(item.start_at, item.end_at)}</p>
        </div>
      </div>
      <p className="text-sm text-ink/70">
        {item.title}
        {item.city && (
          <span className="text-ink/45"> · {cityState(item.city, item.state)}</span>
        )}
      </p>
    </Link>
  );
}
