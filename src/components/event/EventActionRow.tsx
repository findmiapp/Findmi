"use client";

import type { ReactNode } from "react";
import FormAction from "../FormAction";
import AddToCalendarButton from "../AddToCalendarButton";
import { useEventOccurrence } from "../EventOccurrenceContext";
import { resolveEventCtas, type EventCtaConfig } from "../EventScheduleCtas";
import { useOccurrenceDirections } from "../EventUtilityActions";
import type { EventLocationCardLocation } from "../EventLocationCard";
import DirectionsIconLink from "./DirectionsIconLink";
import { EVENT_PRIMARY_CTA_CLASS, EVENT_SECONDARY_CTA_CLASS, secondaryCtaContent } from "@/lib/event-actions";

/** Multi-date Event action zone, resolved per selected date:
 *
 *   [ GET TICKETS / RSVP ] [Directions] [Save] [Calendar] [Share]
 *   Follow · Interested in vending? Apply →
 *
 * With no ticket / RSVP action, Directions expands into the primary slot
 * (Follow moves to the second line); with neither, Follow takes it. The
 * single-date path in EventPublicView renders the same layout server-side. */
export default function EventActionRow({
  cta,
  eventId,
  eventName,
  description,
  directionsEnabled,
  canonicalLocation,
  save,
  share,
  followBlock,
  followCompact,
}: {
  cta: EventCtaConfig;
  eventId: string;
  eventName: string;
  description: string | null;
  directionsEnabled: boolean;
  canonicalLocation: (EventLocationCardLocation & { id: string }) | null;
  save: ReactNode;
  share: ReactNode;
  followBlock: ReactNode;
  followCompact: ReactNode;
}) {
  const { selected, selectedState } = useEventOccurrence();
  const active = Boolean(selected) && selectedState !== "cancelled";
  const actions = active && selected ? resolveEventCtas(selected, cta) : [];
  const primary = actions.find((a) => a.weight === "solid") ?? null;
  const secondary = actions.filter((a) => a !== primary);
  const directions = useOccurrenceDirections(eventId, directionsEnabled, canonicalLocation);
  const track = (eventName: (typeof actions)[number]["eventName"]) => ({
    event_name: eventName,
    subject_type: "event_occurrence",
    subject_id: selected!.id,
    event_id: eventId,
    event_occurrence_id: selected!.id,
    location_id: selected!.location?.id ?? undefined,
  });

  const hasDirections = Boolean(directions.href && directions.trackPayload);
  const mainSlot = primary ? (
    <FormAction
      href={primary.action.url}
      displayMode={primary.action.displayMode}
      label={primary.label}
      className={EVENT_PRIMARY_CTA_CLASS}
      track={track(primary.eventName)}
    />
  ) : hasDirections ? (
    <DirectionsIconLink variant="expanded" href={directions.href!} placeName={directions.placeName} trackPayload={directions.trackPayload!} />
  ) : (
    followBlock
  );
  const followInSecondary = Boolean(primary || hasDirections);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-1.5 sm:gap-2">
        <div className="flex min-w-0 flex-1 empty:hidden">{mainSlot}</div>
        {primary && hasDirections && (
          <DirectionsIconLink href={directions.href!} placeName={directions.placeName} trackPayload={directions.trackPayload!} />
        )}
        {save}
        {active && selected && (
          <AddToCalendarButton
            title={eventName}
            description={description}
            location={directions.locationLine}
            startAt={selected.start_at}
            endAt={selected.end_at}
            layout="icon"
          />
        )}
        {share}
      </div>
      {(followInSecondary && followCompact) || secondary.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {followInSecondary ? followCompact : null}
          {secondary.map((a) => {
            const c = secondaryCtaContent(a.label);
            return (
              <span key={a.label} className="inline-flex items-center gap-1.5">
                {c.prompt && <span className="text-metadata text-muted">{c.prompt}</span>}
                <FormAction
                  href={a.action.url}
                  displayMode={a.action.displayMode}
                  label={c.text}
                  className={EVENT_SECONDARY_CTA_CLASS}
                  track={track(a.eventName)}
                />
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
