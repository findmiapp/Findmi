import Link from "next/link";
import NavIcon from "@/components/NavIcon";
import { formatTime } from "@/lib/format";

/** /account V2, Pass 1 — Presence. Establishes the structure the next pass
 * builds on (Upcoming · Past · Locations) while reusing what exists today:
 *   Upcoming  — the existing Where I'll Be management (rendered by the page)
 *   Past      — getPastAppearancesForBusiness (existing loader, read-only)
 *   Locations — places the signed-in owner already manages (location_members);
 *               Business-linked Locations arrive with business_locations. */

export type PresenceView = "upcoming" | "past" | "locations";

const APP_TIMEZONE = "America/New_York";

export function parsePresenceView(raw: string | undefined): PresenceView {
  return raw === "past" || raw === "locations" ? raw : "upcoming";
}

export function PresenceHeader({ basePath, view }: { basePath: string; view: PresenceView }) {
  const items: { key: PresenceView; label: string }[] = [
    { key: "upcoming", label: "Upcoming" },
    { key: "past", label: "Past" },
    { key: "locations", label: "Locations" },
  ];
  return (
    <div className="flex flex-col gap-3">
      <h1 className="font-display text-page-title-lg font-bold text-primary">Presence</h1>
      <nav aria-label="Presence" className="flex w-full gap-1 rounded-full bg-black/[0.04] p-1 sm:w-fit">
        {items.map((i) => {
          const active = i.key === view;
          return (
            <Link
              key={i.key}
              href={i.key === "upcoming" ? `${basePath}?tab=findmi-here` : `${basePath}?tab=findmi-here&view=${i.key}`}
              aria-current={active ? "page" : undefined}
              className={`flex h-9 flex-1 items-center justify-center rounded-full px-4 text-button font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40 sm:flex-none ${
                active ? "bg-white text-primary shadow-sm" : "text-muted hover:text-primary"
              }`}
            >
              {i.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export interface PastPresenceItem {
  id: string;
  title: string;
  startAt: string;
  endAt: string | null;
  venueName: string | null;
  city: string | null;
  state: string | null;
  eventSlug: string | null;
}

export function PastPresence({ items }: { items: PastPresenceItem[] }) {
  if (items.length === 0) {
    return <p className="text-body text-muted">Nothing in the past yet. Appearances move here after they end.</p>;
  }
  return (
    <ul className="flex flex-col divide-y divide-black/[0.06]">
      {items.map((a) => {
        const place = a.venueName ?? ([a.city, a.state].filter(Boolean).join(", ") || null);
        const body = (
          <>
            <span className="flex w-12 shrink-0 flex-col items-center rounded-xl bg-black/[0.04] py-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wide text-muted">
                {new Date(a.startAt).toLocaleDateString("en-US", { month: "short", timeZone: APP_TIMEZONE })}
              </span>
              <span className="font-display text-lg font-bold leading-none text-primary">
                {new Date(a.startAt).toLocaleDateString("en-US", { day: "numeric", timeZone: APP_TIMEZONE })}
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-card-title font-semibold text-primary">{a.title}</span>
              <span className="block truncate text-metadata text-muted">
                {new Date(a.startAt).toLocaleDateString("en-US", { year: "numeric", timeZone: APP_TIMEZONE })} ·{" "}
                {formatTime(a.startAt)}
                {a.endAt ? `–${formatTime(a.endAt)}` : ""}
                {place ? ` · ${place}` : ""}
              </span>
            </span>
          </>
        );
        return (
          <li key={a.id}>
            {a.eventSlug ? (
              <Link href={`/event/${a.eventSlug}`} className="flex items-center gap-3 py-3">
                {body}
                <span aria-hidden="true" className="shrink-0 text-ink/25">
                  →
                </span>
              </Link>
            ) : (
              <div className="flex items-center gap-3 py-3">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function LocationsPresence({ locations, businessName }: { locations: { id: string; name: string }[]; businessName: string }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-xl text-body text-muted">
        Places you manage on Findmi. Connecting places directly to {businessName} is coming next.
      </p>
      {locations.length > 0 && (
        <ul className="divide-y divide-black/[0.06] overflow-hidden rounded-2xl border border-black/[0.07] bg-white">
          {locations.map((l) => (
            <li key={l.id}>
              <Link href={`/account/location/${l.id}`} className="flex min-h-[56px] items-center gap-3 px-4 py-3 transition hover:bg-black/[0.02]">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-findmi-50 text-findmi-700">
                  <NavIcon name="pin" className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1 truncate text-card-title font-semibold text-primary">{l.name}</span>
                <span aria-hidden="true" className="shrink-0 text-ink/25">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link
        href="/account/location/new"
        className="flex h-11 w-fit items-center rounded-full bg-findmi px-5 text-button font-bold text-white transition hover:bg-findmi-600"
      >
        + Add location
      </Link>
    </div>
  );
}
