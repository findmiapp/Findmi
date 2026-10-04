import Link from "next/link";
import NavIcon from "@/components/NavIcon";
import { formatTime } from "@/lib/format";
import type { BusinessLocationItem, ManagedLocationItem } from "@/lib/business-locations";
import { connectBusinessLocation, makePrimaryBusinessLocation, removeBusinessLocation } from "../../location-actions";

/** /account V2, Pass 1 — Presence. Establishes the structure the next pass
 * builds on (Upcoming · Past · Locations) while reusing what exists today:
 *   Upcoming  — the existing Where I'll Be management (rendered by the page)
 *   Past      — getPastAppearancesForBusiness (existing loader, read-only)
 *   Locations — Pass 2: the Business's own connected Locations
 *               (business_locations), see LocationsPresence below. */

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

export interface LocationsPresenceProps {
  basePath: string;
  businessId: string;
  businessName: string;
  locations: BusinessLocationItem[];
  hasMore: boolean;
  /** Locations the viewer manages (owner/manager) that aren't connected yet
   * — the only pool "Connect a location you manage" offers. */
  connectable: ManagedLocationItem[];
  /** Connected Locations the viewer can also manage (Manage link, Remove). */
  manageableIds: string[];
  /** Owner/manager of this Business (staff see the list read-only). */
  canEdit: boolean;
  addOpen: boolean;
  confirmRemoveId: string | null;
  notice: string | null;
}

/** /account V2 Pass 2 — Presence -> Locations: the places where this
 * Business has an ongoing physical presence (business_locations). Never
 * Sold Here, never temporary Appearances — those live elsewhere. */
export function LocationsPresence({
  basePath,
  businessId,
  businessName,
  locations,
  hasMore,
  connectable,
  manageableIds,
  canEdit,
  addOpen,
  confirmRemoveId,
  notice,
}: LocationsPresenceProps) {
  const locationsPath = `${basePath}?tab=findmi-here&view=locations`;
  const createHref = `/account/location/new?business_id=${encodeURIComponent(businessId)}`;
  const manageable = new Set(manageableIds);
  const noticeCopy =
    notice === "created"
      ? "Location created and connected. It appears publicly once Findmi has reviewed it."
      : notice === "connected"
        ? "Location connected."
        : notice === "removed"
          ? `Removed from ${businessName}. The location itself is still on Findmi.`
          : notice === "primary"
            ? "Primary location updated."
            : null;
  const addButton = canEdit ? (
    <Link
      href={connectable.length > 0 ? `${locationsPath}&add=1` : createHref}
      className="flex h-11 w-fit items-center rounded-full bg-findmi px-5 text-button font-bold text-white transition hover:bg-findmi-600"
    >
      + Add location
    </Link>
  ) : null;

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {noticeCopy && (
        <p role="status" className="rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-body text-findmi-700">
          {noticeCopy}
        </p>
      )}

      {locations.length === 0 ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-black/[0.07] bg-white px-5 py-6">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-findmi-50 text-findmi-700">
            <NavIcon name="pin" className="h-6 w-6" />
          </span>
          <div>
            <h2 className="font-display text-section-title font-bold text-primary">Locations</h2>
            <p className="mt-1 max-w-md text-body text-muted">
              Add and manage locations for {businessName}.
            </p>
          </div>
          {!addOpen && addButton}
        </div>
      ) : (
        <>
          <p className="text-metadata text-muted">
            {hasMore ? `Showing the first ${locations.length} locations` : `${locations.length} ${locations.length === 1 ? "location" : "locations"}`}
          </p>
          <ul className="flex flex-col gap-3">
            {locations.map((l) => (
              <LocationCard
                key={l.locationId}
                item={l}
                businessId={businessId}
                businessName={businessName}
                locationsPath={locationsPath}
                canManageLocation={manageable.has(l.locationId)}
                canEdit={canEdit}
                showPrimaryAction={locations.length > 1}
                confirming={confirmRemoveId === l.locationId}
              />
            ))}
          </ul>
          {!addOpen && addButton}
        </>
      )}

      {canEdit && addOpen && (
        <section aria-label="Add location" className="rounded-2xl border border-black/[0.07] bg-white p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-display text-card-title-lg font-bold text-primary">Add location</h2>
            <Link href={locationsPath} className="text-metadata font-semibold text-muted hover:text-primary">
              Cancel
            </Link>
          </div>
          <Link
            href={createHref}
            className="mt-3 flex min-h-[56px] items-center gap-3 rounded-xl border border-black/[0.07] px-4 py-3 transition hover:border-black/15"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-findmi-50 text-lg font-bold text-findmi-700">+</span>
            <span className="min-w-0 flex-1">
              <span className="block text-card-title font-semibold text-primary">Create a new location</span>
              <span className="block text-metadata text-muted">Add a place that isn&rsquo;t on Findmi yet</span>
            </span>
            <span aria-hidden="true" className="shrink-0 text-ink/25">
              ›
            </span>
          </Link>
          {connectable.length > 0 && (
            <>
              <p className="mt-5 px-1 text-label font-bold uppercase text-subtle">Connect a location you manage</p>
              <ul className="mt-2 divide-y divide-black/[0.06] rounded-xl border border-black/[0.07]">
                {connectable.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-card-title font-semibold text-primary">{c.name}</span>
                      <span className="block truncate text-metadata text-muted">
                        {[c.city, c.state].filter(Boolean).join(", ") || "No city yet"}
                        {c.isPending ? " · Pending review" : ""}
                      </span>
                    </span>
                    <form action={connectBusinessLocation.bind(null, businessId)}>
                      <input type="hidden" name="location_id" value={c.id} />
                      <button
                        type="submit"
                        className="flex h-9 items-center rounded-full border border-black/10 px-4 text-metadata font-semibold text-secondary transition hover:border-black/20"
                      >
                        Connect
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function LocationCard({
  item,
  businessId,
  businessName,
  locationsPath,
  canManageLocation,
  canEdit,
  showPrimaryAction,
  confirming,
}: {
  item: BusinessLocationItem;
  businessId: string;
  businessName: string;
  locationsPath: string;
  canManageLocation: boolean;
  canEdit: boolean;
  showPrimaryAction: boolean;
  confirming: boolean;
}) {
  const cityLine = [item.city, item.state].filter(Boolean).join(", ");
  const publicHref = !item.isPending && !item.isArchived ? `/location/${item.slug}` : null;
  const canSetPrimary = canEdit && showPrimaryAction && !item.isPrimary;
  const canRemove = canEdit && canManageLocation;
  const status = item.isArchived ? "Archived" : item.isPending ? "Pending review" : null;

  return (
    <li className="relative rounded-2xl border border-black/[0.07] bg-white">
      <div className="flex items-start gap-3 px-4 py-3.5">
        {item.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.logoUrl} alt="" className="h-11 w-11 shrink-0 rounded-xl border border-black/[0.06] object-cover" />
        ) : (
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-findmi-50 text-findmi-700">
            <NavIcon name="pin" className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 truncate text-card-title font-semibold text-primary">{item.name}</span>
            {item.isPrimary && (
              <span className="shrink-0 rounded-full bg-findmi-50 px-2 py-0.5 text-label font-bold uppercase text-findmi-700">Primary</span>
            )}
          </div>
          {item.address && <p className="mt-0.5 truncate text-metadata text-muted">{item.address}</p>}
          {cityLine && <p className="truncate text-metadata text-muted">{cityLine}</p>}
          {status && (
            <p className="mt-1.5 inline-flex whitespace-nowrap rounded-full bg-black/[0.04] px-2 py-0.5 text-label font-bold uppercase text-muted">
              {status}
            </p>
          )}
          {canManageLocation ? (
            <Link
              href={`/account/location/${item.locationId}`}
              className="mt-2 inline-flex items-center text-metadata font-semibold text-findmi-700 hover:underline"
            >
              Manage location →
            </Link>
          ) : publicHref ? (
            <Link href={publicHref} className="mt-2 inline-flex items-center text-metadata font-semibold text-findmi-700 hover:underline">
              View page →
            </Link>
          ) : null}
        </div>
        <div className="-mr-1.5 -mt-1 flex shrink-0 items-center">
          {(canSetPrimary || canRemove) && (
            <details className="relative">
              <summary
                aria-label={`More actions for ${item.name}`}
                className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full text-muted transition hover:bg-black/[0.04] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40 [&::-webkit-details-marker]:hidden"
              >
                <KebabGlyph className="h-5 w-5" />
              </summary>
              <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-2xl border border-black/[0.07] bg-white p-1.5 shadow-lg">
                {canSetPrimary && (
                  <form action={makePrimaryBusinessLocation.bind(null, businessId, item.locationId)}>
                    <button type="submit" className="flex w-full items-center rounded-xl px-3 py-2.5 text-left text-body font-medium text-primary transition hover:bg-black/[0.04]">
                      Set as primary
                    </button>
                  </form>
                )}
                {canRemove && (
                  <Link
                    href={`${locationsPath}&remove=${item.locationId}`}
                    className="flex w-full items-center rounded-xl px-3 py-2.5 text-body font-medium text-red-600 transition hover:bg-red-50"
                  >
                    Remove from {businessName}
                  </Link>
                )}
              </div>
            </details>
          )}
        </div>
      </div>
      {confirming && canRemove && (
        <div className="border-t border-black/[0.06] px-4 py-3.5">
          <p className="text-body font-semibold text-primary">
            Remove {item.name} from {businessName}?
          </p>
          <p className="mt-1 text-metadata text-muted">
            {item.name} stays on Findmi. This only removes its connection to {businessName}. Its page, events and
            appearances aren&rsquo;t affected.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <form action={removeBusinessLocation.bind(null, businessId, item.locationId)}>
              <button type="submit" className="flex h-9 items-center rounded-full border border-red-200 bg-white px-4 text-metadata font-bold text-red-600 transition hover:bg-red-50">
                Remove
              </button>
            </form>
            <Link href={locationsPath} className="flex h-9 items-center rounded-full px-4 text-metadata font-semibold text-muted transition hover:text-primary">
              Cancel
            </Link>
          </div>
        </div>
      )}
    </li>
  );
}

function KebabGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <circle cx="5.5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="18.5" cy="12" r="1.7" />
    </svg>
  );
}
