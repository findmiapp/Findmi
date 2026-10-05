"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import NavIcon from "@/components/NavIcon";
import MomentSearch, { MOMENT_TYPE_ICON, MOMENT_TYPE_LABEL, type MomentObjectType, type MomentSearchResult } from "./MomentSearch";
import { getEventOccurrencesForJournal, type JournalOccurrenceOption } from "@/app/(public)/my-world/journal/actions";
import { EMPTY_MANUAL_LOCATION, manualLocationHasText, type JournalManualLocationState, type MomentEventPick, type MomentPick } from "@/lib/moment-composer";

export function formatOccurrence(occ: { start_at: string; end_at: string; timezone: string }): string {
  const date = new Date(occ.start_at).toLocaleDateString("en-US", { timeZone: occ.timezone, weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: occ.timezone, hour: "numeric", minute: "2-digit" });
  return `${date} · ${time(occ.start_at)}–${time(occ.end_at)}`;
}

/** Moments V2 — Stage 1, "Context": WHERE / WHAT was this, then WHO /
 * WHAT was part of it. One canonical Location (or a described place) and
 * any number of Events — each Event keeps its own date — then any number
 * of Businesses, Products and more Events. Everything is removable,
 * including context that arrived as a prefill. */
export default function MomentContextStage({
  location,
  onPickLocation,
  onRemoveLocation,
  manual,
  onManualChange,
  events,
  onAddEvent,
  onRemoveEvent,
  onSelectOccurrence,
  businesses,
  products,
  onAddBusiness,
  onAddProduct,
  onRemoveBusiness,
  onRemoveProduct,
  autoResolveEventIds,
}: {
  location: MomentPick | null;
  onPickLocation: (location: MomentPick) => void;
  onRemoveLocation: () => void;
  manual: JournalManualLocationState;
  onManualChange: (manual: JournalManualLocationState) => void;
  events: MomentEventPick[];
  onAddEvent: (event: MomentPick, origin: "where" | "who") => void;
  onRemoveEvent: (eventId: string) => void;
  onSelectOccurrence: (occ: JournalOccurrenceOption) => void;
  businesses: MomentPick[];
  products: MomentPick[];
  onAddBusiness: (business: MomentPick) => void;
  onAddProduct: (product: MomentPick) => void;
  onRemoveBusiness: (id: string) => void;
  onRemoveProduct: (id: string) => void;
  /** Prefilled Events whose date is still unknown: their date choices are
   * shown straight away instead of waiting for a tap. */
  autoResolveEventIds?: string[];
}) {
  const [manualOpen, setManualOpen] = useState(() => manualLocationHasText(manual));
  const [choices, setChoices] = useState<Record<string, JournalOccurrenceOption[] | "loading">>({});

  async function resolveDates(eventId: string) {
    setChoices((prev) => ({ ...prev, [eventId]: "loading" }));
    const options = await getEventOccurrencesForJournal(eventId);
    if (options.length === 1) {
      onSelectOccurrence(options[0]);
      setChoices((prev) => omitKey(prev, eventId));
      return;
    }
    if (options.length === 0) {
      setChoices((prev) => omitKey(prev, eventId));
      return;
    }
    setChoices((prev) => ({ ...prev, [eventId]: options }));
  }

  const autoResolved = useRef(false);
  useEffect(() => {
    if (autoResolved.current) return;
    autoResolved.current = true;
    for (const id of autoResolveEventIds ?? []) void resolveDates(id);
    // Runs once for the initial prefill only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addEvent(result: MomentSearchResult, origin: "where" | "who") {
    onAddEvent({ value: result.value, label: result.label, sublabel: result.sublabel, image_url: result.image_url }, origin);
    void resolveDates(result.value);
  }

  function pickWhere(result: MomentSearchResult) {
    if (result.type === "location") {
      onManualChange(EMPTY_MANUAL_LOCATION);
      setManualOpen(false);
      onPickLocation({ value: result.value, label: result.label, sublabel: result.sublabel, image_url: result.image_url });
    } else if (result.type === "event") {
      addEvent(result, "where");
    }
  }

  function pickWho(result: MomentSearchResult) {
    const pick = { value: result.value, label: result.label, sublabel: result.sublabel, image_url: result.image_url };
    if (result.type === "business") onAddBusiness(pick);
    else if (result.type === "product") onAddProduct(pick);
    else if (result.type === "event") addEvent(result, "who");
  }

  function removeEvent(eventId: string) {
    setChoices((prev) => omitKey(prev, eventId));
    onRemoveEvent(eventId);
  }

  const eventIds = events.map((e) => e.value);
  const whereEvents = events.filter((e) => e.origin === "where");
  const whoEvents = events.filter((e) => e.origin === "who");

  function eventCard(event: MomentEventPick) {
    const state = choices[event.value];
    return (
      <div key={event.value} className="rounded-2xl border border-black/10 bg-white p-2.5">
        <div className="flex items-center gap-2.5">
          <Thumb image={event.image_url} type="event" />
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm font-semibold leading-snug text-ink">{event.label}</p>
            <p className="text-xs font-semibold text-findmi-700">Event</p>
            {event.occurrence && <p className="text-xs text-ink/55">{formatOccurrence(event.occurrence)}</p>}
          </div>
          <RemoveButton label={event.label} onClick={() => removeEvent(event.value)} />
        </div>
        {!event.occurrence && state === undefined && (
          <button
            type="button"
            onClick={() => void resolveDates(event.value)}
            className="mt-2 inline-flex items-center rounded-full border border-findmi/40 bg-findmi-50 px-2.5 py-1 text-[11px] font-bold text-findmi-700 transition hover:border-findmi/60"
          >
            Which Date Was This?
          </button>
        )}
        {state === "loading" && <p className="mt-2 text-xs text-ink/40">Checking dates…</p>}
        {Array.isArray(state) && (
          <div className="mt-2 flex flex-col gap-1.5">
            <p className="text-xs font-semibold text-ink/60">Which date was this?</p>
            <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
              {state.map((occ) => (
                <button
                  key={occ.id}
                  type="button"
                  onClick={() => {
                    onSelectOccurrence(occ);
                    setChoices((prev) => omitKey(prev, event.value));
                  }}
                  className={`rounded-xl border px-3 py-2 text-left text-sm transition hover:border-findmi/40 hover:bg-findmi-50 ${
                    event.occurrence?.id === occ.id ? "border-findmi bg-findmi-50" : "border-black/10 bg-white"
                  }`}
                >
                  {formatOccurrence(occ)}
                  {occ.location && <span className="block truncate text-xs text-ink/50">{occ.location.name}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
        {event.occurrence && state === undefined && (
          <button type="button" onClick={() => void resolveDates(event.value)} className="mt-1.5 text-[11px] font-semibold text-ink/45 hover:text-ink">
            Change Date
          </button>
        )}
      </div>
    );
  }

  function manualField(key: keyof Omit<JournalManualLocationState, "suggest">, label: string, placeholder: string) {
    return (
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-xs font-semibold text-ink/50">{label}</span>
        <input
          type="text"
          value={manual[key]}
          onChange={(e) => onManualChange({ ...manual, [key]: e.target.value })}
          placeholder={placeholder}
          className="h-11 w-full rounded-xl border border-black/10 bg-white px-3.5 text-sm text-ink placeholder:text-ink/40 focus:border-findmi/50 focus:outline-none"
        />
      </label>
    );
  }

  return (
    <div className="flex flex-col gap-7">
      <section className="flex flex-col gap-2.5">
        <div>
          <h2 className="font-display text-base font-bold tracking-tight text-ink">Where / What?</h2>
          <p className="text-sm text-ink/55">Find the place or event this Moment happened at.</p>
        </div>
        <MomentSearch
          mode="where"
          placeholder="Search places and events…"
          excludeIds={[...(location ? [location.value] : []), ...eventIds]}
          onPick={pickWhere}
        />

        {location && (
          <div className="flex items-center gap-2.5 rounded-2xl border border-black/10 bg-white p-2.5">
            <Thumb image={location.image_url} type="location" />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-semibold leading-snug text-ink">{location.label}</p>
              <p className="truncate text-xs text-ink/50">
                <span className="font-semibold text-findmi-700">Location</span>
                {location.sublabel ? ` · ${location.sublabel}` : ""}
              </p>
            </div>
            <RemoveButton label={location.label} onClick={onRemoveLocation} />
          </div>
        )}

        {whereEvents.map(eventCard)}

        {!location &&
          (manualOpen ? (
            <div className="flex flex-col gap-2.5 rounded-2xl border border-black/10 bg-white p-3.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-ink">Describe The Place</p>
                <button
                  type="button"
                  onClick={() => {
                    onManualChange(EMPTY_MANUAL_LOCATION);
                    setManualOpen(false);
                  }}
                  className="shrink-0 text-xs font-semibold text-ink/50 hover:text-ink"
                >
                  Remove
                </button>
              </div>
              {manualField("name", "Place Name", "e.g. Friend's rooftop")}
              {manualField("address", "Address", "477 Broadway")}
              {manualField("city", "City", "New York")}
              <div className="grid grid-cols-2 gap-2.5">
                {manualField("state", "State", "NY")}
                {manualField("zip", "ZIP", "10013")}
              </div>
              <label className="mt-1 flex items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={manual.suggest}
                  onChange={(e) => onManualChange({ ...manual, suggest: e.target.checked })}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-black/20 text-findmi focus:ring-findmi/40"
                />
                <span className="text-xs text-ink/60">
                  <span className="block font-semibold text-ink/80">Suggest This Place To Findmi</span>
                  We may consider adding it as a Findmi location.
                </span>
              </label>
            </div>
          ) : (
            <button type="button" onClick={() => setManualOpen(true)} className="w-fit text-xs font-semibold text-findmi-700 transition hover:text-findmi-800">
              Can&rsquo;t Find The Place? Describe It
            </button>
          ))}
      </section>

      <section className="flex flex-col gap-2.5">
        <div>
          <h2 className="font-display text-base font-bold tracking-tight text-ink">Who / What Was There?</h2>
          <p className="text-sm text-ink/55">Add the businesses, products and events that were part of it.</p>
        </div>
        <MomentSearch
          mode="who"
          placeholder="Search businesses, products, events…"
          excludeIds={[...businesses.map((b) => b.value), ...products.map((p) => p.value), ...eventIds]}
          onPick={pickWho}
        />
        {(businesses.length > 0 || products.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {businesses.map((b) => (
              <Chip key={`b-${b.value}`} pick={b} type="business" onRemove={() => onRemoveBusiness(b.value)} />
            ))}
            {products.map((p) => (
              <Chip key={`p-${p.value}`} pick={p} type="product" onRemove={() => onRemoveProduct(p.value)} />
            ))}
          </div>
        )}
        {whoEvents.map(eventCard)}
      </section>
    </div>
  );
}

function Thumb({ image, type }: { image?: string | null; type: MomentObjectType }) {
  return (
    <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-black/5 text-ink/35">
      {image ? <Image src={image} alt="" fill unoptimized sizes="44px" className="object-cover" /> : <NavIcon name={MOMENT_TYPE_ICON[type]} className="h-5 w-5" />}
    </span>
  );
}

function Chip({ pick, type, onRemove }: { pick: MomentPick; type: MomentObjectType; onRemove: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-black/10 bg-white py-1 pl-1 pr-1.5">
      <span className="relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-black/5 text-ink/35">
        {pick.image_url ? (
          <Image src={pick.image_url} alt="" fill unoptimized sizes="28px" className="object-cover" />
        ) : (
          <NavIcon name={MOMENT_TYPE_ICON[type]} className="h-3.5 w-3.5" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium leading-tight text-ink">{pick.label}</span>
        <span className="block text-[10px] font-semibold leading-tight text-findmi-700">{MOMENT_TYPE_LABEL[type]}</span>
      </span>
      <RemoveButton label={pick.label} onClick={onRemove} />
    </span>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Remove ${label}`}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-base leading-none text-ink/40 transition hover:bg-black/5 hover:text-ink"
    >
      ×
    </button>
  );
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}
