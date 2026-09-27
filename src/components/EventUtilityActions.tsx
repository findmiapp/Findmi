"use client";

import type { ReactNode } from "react";
import { useEventOccurrence } from "./EventOccurrenceContext";
import AddToCalendarButton from "./AddToCalendarButton";
import { cityState } from "@/lib/format";

const GRID_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};

/** Event Detail Action Bar Correction pass — shared shell for the Event
 * page's Tier B utility row (Message/Save/Add to Calendar/Share). Column
 * count is DERIVED from how many items are actually passed, never fixed
 * at 4 — a missing action (no Message configured, no selected occurrence
 * for Add to Calendar) reflows the remaining actions to fill the row
 * evenly instead of leaving an empty cell. Each item is expected to fill
 * its own cell (its component's own `layout="grid"` prop handles that). */
export function UtilityActionGrid({ items }: { items: ReactNode[] }) {
  if (items.length === 0) return null;
  return (
    <div className={`mt-3 grid gap-2 ${GRID_COLS[items.length] ?? "grid-cols-4"}`}>
      {items.map((item, i) => (
        <div key={i} className="h-[58px]">
          {item}
        </div>
      ))}
    </div>
  );
}

/** Recurring-event Tier B utility row. Message/Save/Share are passed in
 * already-built (they don't depend on the selected occurrence), so this
 * component's only job is the one piece that DOES — Add to Calendar,
 * resolved from the shared selected-occurrence context (client-only,
 * unknowable at SSR) — deciding whether it joins the grid. Never returns
 * null itself: Save is always passed and always renders, so there's no
 * "hide the whole row" case, only "how many columns" to compute. */
export default function EventUtilityActions({
  eventName,
  description,
  message,
  save,
  share,
}: {
  eventName: string;
  description: string | null;
  message: ReactNode | null;
  save: ReactNode;
  share: ReactNode;
}) {
  const { selected, selectedState } = useEventOccurrence();
  const canShowCalendar = Boolean(selected) && selectedState !== "cancelled";

  const location = selected?.location ?? null;
  const locationLine = location
    ? [location.name, location.address, cityState(location.city, location.state)].filter(Boolean).join(" · ")
    : null;

  const items = [
    message,
    save,
    canShowCalendar && selected ? (
      <AddToCalendarButton
        key="calendar"
        title={eventName}
        description={description}
        location={locationLine}
        startAt={selected.start_at}
        endAt={selected.end_at}
        layout="grid"
      />
    ) : null,
    share,
  ].filter((item): item is ReactNode => Boolean(item));

  return <UtilityActionGrid items={items} />;
}
