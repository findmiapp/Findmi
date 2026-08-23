import Image from "next/image";
import Link from "next/link";
import type { FindmiEvent } from "@/lib/types";
import { cityState, formatDateRange } from "@/lib/format";

export default function EventCard({ event }: { event: FindmiEvent }) {
  return (
    <Link
      href={`/event/${event.slug}`}
      className="group flex shrink-0 flex-col overflow-hidden rounded-2xl border border-black/5 bg-white transition hover:shadow-lg hover:shadow-black/5"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-black/5">
        {event.cover_image_url && (
          <Image
            src={event.cover_image_url}
            alt={event.name}
            fill
            sizes="(min-width: 768px) 320px, 80vw"
            className="object-cover transition duration-300 group-hover:scale-105"
          />
        )}
        <div className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-ink">
          {formatDateRange(event.start_at, event.end_at)}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <h3 className="text-base font-semibold leading-tight text-ink">{event.name}</h3>
        <p className="text-xs font-medium text-ink/50">
          {[event.venue_name, cityState(event.city, event.state)].filter(Boolean).join(" · ")}
        </p>
      </div>
    </Link>
  );
}
