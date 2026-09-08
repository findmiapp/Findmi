"use client";

import { useState, useTransition } from "react";
import { RelationField } from "@/components/admin/RelationPicker";
import type { SearchResult } from "@/components/admin/useAdminSearch";
import type { SelectOption } from "@/lib/admin/queries";
import { isoToLocalDateTime } from "@/lib/admin/form-helpers";
import { getEventLinkDataForAppearance, type EventLinkOccurrenceOption } from "./actions";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";
const lockedInputClass =
  "w-full rounded-xl border border-black/10 bg-black/[0.03] px-3.5 py-2.5 text-base text-ink/70 focus:outline-none";

interface FieldValues {
  title: string;
  start_local: string;
  end_local: string;
  venue_name: string;
  address: string;
  city: string;
  state: string;
}

interface Snapshot {
  title: string;
  start_at: string;
  end_at: string;
  venue_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
}

/** Existing-Event Autofill pass — root-cause fix for the Perk Up Fest/
 * Viktor Gal Shop QA bug: linking an appearance to a real Findmi Event
 * used to only set a hidden event_id, leaving title/date/venue for the
 * admin to retype by hand (and get wrong — Viktor's date landed a day
 * off, city/state stayed blank). Once an Event — and, when it has more
 * than one date, one of its occurrences — is selected here, that
 * Event/occurrence is authoritative: these fields lock to its own data
 * and stop being freely editable. saveAppearance independently re-derives
 * the exact same values server-side on save (see that action's own
 * comment) — this component is the UX half of that guarantee, not the
 * only place it's enforced. Clearing the Event (or never picking one)
 * leaves every field a plain, freely-editable text input, exactly as
 * before this pass — standalone appearances are completely unaffected. */
export default function AppearanceEventFields({
  initialEvent,
  initialOccurrenceId,
  initialValues,
}: {
  initialEvent: SelectOption | null;
  initialOccurrenceId: string | null;
  initialValues: FieldValues;
}) {
  const [event, setEvent] = useState<SelectOption | SearchResult | null>(initialEvent);
  const [occurrences, setOccurrences] = useState<EventLinkOccurrenceOption[]>([]);
  const [occurrenceId, setOccurrenceId] = useState<string>(initialOccurrenceId ?? "");
  const [fields, setFields] = useState<FieldValues>(initialValues);
  const [isPending, startTransition] = useTransition();

  const linked = Boolean(event);

  function applySnapshot(snapshot: Snapshot) {
    setFields({
      title: snapshot.title,
      start_local: isoToLocalDateTime(snapshot.start_at),
      end_local: isoToLocalDateTime(snapshot.end_at),
      venue_name: snapshot.venue_name ?? "",
      address: snapshot.address ?? "",
      city: snapshot.city ?? "",
      state: snapshot.state ?? "",
    });
  }

  function handleEventSelect(picked: SearchResult | null) {
    setEvent(picked);
    setOccurrences([]);
    setOccurrenceId("");
    if (!picked) return; // cleared → back to a standalone appearance; leave current field values freely editable
    startTransition(async () => {
      const data = await getEventLinkDataForAppearance(picked.value);
      if (!data) return;
      if (data.occurrences.length === 0) {
        applySnapshot(data);
      } else if (data.occurrences.length === 1) {
        setOccurrences(data.occurrences);
        setOccurrenceId(data.occurrences[0].id);
        applySnapshot({ title: data.title, ...data.occurrences[0] });
      } else {
        // Multiple dates — require an explicit pick (Section B), so
        // fields stay locked-blank rather than showing stale data from
        // whatever was previously in them until one is chosen.
        setOccurrences(data.occurrences);
        setFields({ title: data.title, start_local: "", end_local: "", venue_name: "", address: "", city: "", state: "" });
      }
    });
  }

  function handleOccurrenceChange(occId: string) {
    setOccurrenceId(occId);
    const occ = occurrences.find((o) => o.id === occId);
    if (occ && event) applySnapshot({ title: event.label, ...occ });
  }

  return (
    <div className="flex flex-col gap-5">
      <RelationField
        label="Related Findmi Event"
        name="event_id"
        entity="events"
        initial={initialEvent}
        clearLabel="No event — link to Google Maps directions instead"
        hint="If set, this appearance's title/date/venue come straight from the Event (or the date you pick below) — Findmi already knows them."
        createHref="/admin/events/new"
        createLabel="New Event"
        onSelect={handleEventSelect}
      />
      <input type="hidden" name="event_occurrence_id" value={occurrenceId} />

      {linked && occurrences.length > 1 && (
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Which date?</span>
          <select
            required
            value={occurrenceId}
            onChange={(e) => handleOccurrenceChange(e.target.value)}
            className={inputClass}
          >
            <option value="" disabled>
              Select this Event&rsquo;s date…
            </option>
            {occurrences.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-ink/45">
            This Event has multiple dates — pick the one this appearance is for.
          </p>
        </label>
      )}

      {isPending && <p className="text-xs text-ink/45">Loading Event details…</p>}

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink">Appearance Title</span>
        <input
          type="text"
          name="title"
          required={!linked}
          readOnly={linked}
          value={fields.title}
          onChange={(e) => setFields((f) => ({ ...f, title: e.target.value }))}
          placeholder="What shows on the card — e.g. 'Minthorne Market'."
          className={linked ? lockedInputClass : inputClass}
        />
        {linked && <p className="mt-1 text-xs text-ink/45">From the linked Event — edit the Event itself to change this.</p>}
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Start Date & Time</span>
          <input
            type="datetime-local"
            name="start_at"
            required={!linked}
            readOnly={linked}
            value={fields.start_local}
            onChange={(e) => setFields((f) => ({ ...f, start_local: e.target.value }))}
            className={linked ? lockedInputClass : inputClass}
          />
          <p className="mt-1 text-xs text-ink/45">Eastern time (America/New_York).</p>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">End Date & Time</span>
          <input
            type="datetime-local"
            name="end_at"
            required={!linked}
            readOnly={linked}
            value={fields.end_local}
            onChange={(e) => setFields((f) => ({ ...f, end_local: e.target.value }))}
            className={linked ? lockedInputClass : inputClass}
          />
          <p className="mt-1 text-xs text-ink/45">
            {linked
              ? "From the linked Event."
              : "Required — must be after the start time. Also Eastern time. Used to keep the appearance visible on the site for its whole real duration, not just until it starts."}
          </p>
        </label>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink">Venue Name</span>
        <input
          type="text"
          name="venue_name"
          readOnly={linked}
          value={fields.venue_name}
          onChange={(e) => setFields((f) => ({ ...f, venue_name: e.target.value }))}
          className={linked ? lockedInputClass : inputClass}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Address</span>
          <input
            type="text"
            name="address"
            readOnly={linked}
            value={fields.address}
            onChange={(e) => setFields((f) => ({ ...f, address: e.target.value }))}
            className={linked ? lockedInputClass : inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">City</span>
          <input
            type="text"
            name="city"
            readOnly={linked}
            value={fields.city}
            onChange={(e) => setFields((f) => ({ ...f, city: e.target.value }))}
            className={linked ? lockedInputClass : inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">State</span>
          <input
            type="text"
            name="state"
            readOnly={linked}
            value={fields.state}
            onChange={(e) => setFields((f) => ({ ...f, state: e.target.value }))}
            className={linked ? lockedInputClass : inputClass}
          />
        </label>
      </div>
      {linked && (
        <p className="-mt-2 text-xs text-ink/45">
          Venue/address come from the linked Event{occurrences.length > 0 ? "'s selected date" : ""} — edit the
          Event itself to change them.
        </p>
      )}
    </div>
  );
}
