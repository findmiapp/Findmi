"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import NavIcon from "@/components/NavIcon";
import {
  AVAILABILITY_NOTE_MAX,
  AVAILABILITY_RELATIONSHIPS,
  AVAILABILITY_RELATIONSHIP_LABELS,
  AVAILABILITY_SOURCE_LABELS,
  AVAILABILITY_STATUS_LABELS,
  availabilityTiming,
  availabilityWhenLabel,
  type AvailabilityRelationship,
  type AvailabilityTiming,
} from "@/lib/business-availability-domain";
import type { OwnerAvailabilityItem } from "@/lib/business-availability-owner";
import { removeAvailabilityAction, requestAvailabilityAction, searchLocationsForAvailability, updateAvailabilityAction } from "../availability-actions";
import { Chip } from "../../../owner-ui";

type Place = { id: string; name: string; city: string | null; state: string | null };

const STATUS_TONE = { live: "aqua", pending: "amber", declined: "neutral" } as const;

/** Findmi Here → Find Us At: where people can find this Business's
 * products and services OUTSIDE its own Locations and dated Events — a
 * retailer that stocks it, a café that serves it, a venue that features it.
 * Each entry says WHERE (a canonical Location), HOW (stocked / sold /
 * served / featured / sampled), WHAT (which Products — none = the Brand),
 * WHEN (ongoing, a date range, or until a date), and carries a STATUS
 * (Pending Review → Live) and SOURCE (added by the Business / verified by
 * Findmi). Only Live, in-effect entries show on the public profile. */
export default function AvailableAtView({
  businessId,
  available,
  items,
  products,
  canEdit,
}: {
  businessId: string;
  /** false before the availability-details migration is applied. */
  available: boolean;
  items: OwnerAvailabilityItem[];
  products: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const remove = (id: string) =>
    startTransition(async () => {
      setError(null);
      const result = await removeAvailabilityAction(businessId, id);
      if (!result.ok) setError(result.error);
    });

  return (
    <div className="flex flex-col gap-5 lg:max-w-3xl">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-body text-muted">Where people can find your products and services beyond your own locations — a retailer, café or venue that carries you.</p>
        {canEdit && available && !adding && !editingId && (
          <button type="button" onClick={() => setAdding(true)} className="flex h-10 shrink-0 items-center rounded-full bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600">
            Add A Place
          </button>
        )}
      </div>

      {!available && <p className="text-body text-muted">This isn&rsquo;t available yet. Please check back soon.</p>}
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-metadata font-semibold text-red-700">{error}</p>}

      {adding && <PlaceForm businessId={businessId} products={products} onDone={() => setAdding(false)} />}

      {available && items.length === 0 && !adding && (
        <p className="text-body text-muted">Nothing here yet. Add a retailer, café or venue where people can find you.</p>
      )}

      {items.length > 0 && (
        <ul className="flex flex-col divide-y divide-black/[0.06]">
          {items.map((i) =>
            editingId === i.id ? (
              <li key={i.id} className="py-3">
                <PlaceForm businessId={businessId} products={products} initial={i} onDone={() => setEditingId(null)} />
              </li>
            ) : (
            <li key={i.id} className="flex items-start gap-3 py-3">
              <span className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-black/[0.04] text-ink/25">
                {i.imageUrl ? <SupabaseImage src={i.imageUrl} alt="" fill sizes="56px" className="object-cover" /> : <NavIcon name="storefront" className="h-6 w-6" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link href={`/location/${i.locationSlug}`} className="min-w-0 truncate text-card-title font-semibold text-primary hover:underline">
                    {i.locationName}
                  </Link>
                  <Chip tone={STATUS_TONE[i.status]}>{AVAILABILITY_STATUS_LABELS[i.status]}</Chip>
                </span>
                <span className="block truncate text-metadata text-muted">{[i.city, i.state].filter(Boolean).join(", ")}</span>
                <span className="mt-0.5 block text-metadata text-secondary">
                  {AVAILABILITY_RELATIONSHIP_LABELS[i.relationship]} · {availabilityWhenLabel(i.startsOn, i.endsOn)}
                </span>
                <span className="block text-metadata text-muted">
                  {i.products.length > 0 ? i.products.map((p) => p.name).join(", ") : "Your Brand"}
                </span>
                <span className="block text-microcopy text-subtle">
                  {AVAILABILITY_SOURCE_LABELS[i.source]}
                  {i.status === "pending" ? " · Shows publicly once Findmi approves it" : ""}
                  {i.status === "declined" ? " · Contact Findmi with any questions" : ""}
                </span>
              </span>
              {canEdit && (
                <span className="flex shrink-0 flex-col items-end">
                  <button type="button" disabled={pending || adding} onClick={() => setEditingId(i.id)} className="py-1 text-metadata font-semibold text-accent hover:underline disabled:opacity-50">
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => remove(i.id)}
                    className="py-1 text-metadata font-semibold text-muted hover:text-red-700 disabled:opacity-50"
                  >
                    {i.status === "pending" ? "Withdraw" : "Remove"}
                  </button>
                </span>
              )}
            </li>
            )
          )}
        </ul>
      )}
    </div>
  );
}

/** One form for both Add and Edit. Editing never changes the place (that is
 * the entry's identity — remove it and add the new one); everything else —
 * how, which Products, when, the note — is editable. Saving a change sends
 * the entry back to Pending Review, and the form says so up front. */
function PlaceForm({
  businessId,
  products,
  initial,
  onDone,
}: {
  businessId: string;
  products: { id: string; name: string }[];
  initial?: OwnerAvailabilityItem;
  onDone: () => void;
}) {
  const editing = Boolean(initial);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [place, setPlace] = useState<Place | null>(initial ? { id: initial.locationId, name: initial.locationName, city: initial.city, state: initial.state } : null);
  const [relationship, setRelationship] = useState<AvailabilityRelationship>(initial?.relationship ?? "stocked");
  const [productIds, setProductIds] = useState<string[]>(initial?.products.map((p) => p.id) ?? []);
  const [timing, setTiming] = useState<AvailabilityTiming>(initial ? availabilityTiming(initial.startsOn, initial.endsOn) : "ongoing");
  const [startsOn, setStartsOn] = useState(initial?.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(initial?.endsOn ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const timer = useRef<number | null>(null);

  // Debounced server search (≤20 results) — never a list of every Location.
  useEffect(() => {
    if (place || query.trim().length < 2) {
      setResults([]);
      return;
    }
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => setResults(await searchLocationsForAvailability(businessId, query)), 250);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [query, place, businessId]);

  const submit = () =>
    startTransition(async () => {
      setError(null);
      if (!place) return setError("Choose where to find you.");
      const fields = {
        relationship,
        productIds,
        timing,
        startsOn: timing === "date_range" ? startsOn : null,
        endsOn: timing === "ongoing" ? null : endsOn,
        note: note || null,
      };
      const result = initial
        ? await updateAvailabilityAction(businessId, initial.id, fields)
        : await requestAvailabilityAction(businessId, { locationId: place.id, ...fields });
      if (!result.ok) return setError(result.error);
      onDone();
    });

  const toggleProduct = (id: string) => setProductIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  const inputClass = "w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-input text-primary placeholder:text-subtle focus:border-findmi/50 focus:outline-none focus:ring-2 focus:ring-findmi/20";

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-black/[0.08] bg-white p-4">
      <p className="font-display text-card-title-lg font-bold text-primary">{editing ? "Edit Place" : "Add A Place"}</p>

      <div>
        <label htmlFor="avail-place" className="text-metadata font-semibold text-secondary">Where</label>
        {place ? (
          <div className="mt-1 flex items-center justify-between gap-3 rounded-xl bg-findmi-50 px-3 py-2.5">
            <span className="min-w-0 truncate text-body font-semibold text-findmi-700">
              {place.name}
              {place.city ? ` · ${place.city}` : ""}
            </span>
            {!editing && <button type="button" onClick={() => { setPlace(null); setQuery(""); }} className="shrink-0 text-metadata font-semibold text-accent">Change</button>}
          </div>
        ) : (
          <>
            <input id="avail-place" type="search" autoComplete="off" autoCapitalize="none" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search for a retailer, café or venue" className={`mt-1 ${inputClass}`} />
            {results.length > 0 && (
              <ul role="listbox" aria-label="Locations" className="mt-1 max-h-56 overflow-y-auto rounded-xl border border-black/10 bg-white p-1">
                {results.map((r) => (
                  <li key={r.id}>
                    <button type="button" role="option" aria-selected={false} onClick={() => setPlace(r)} className="w-full rounded-lg px-3 py-2 text-left hover:bg-black/[0.03]">
                      <span className="block text-body text-primary">{r.name}</span>
                      <span className="block text-metadata text-muted">{[r.city, r.state].filter(Boolean).join(", ")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {query.trim().length >= 2 && results.length === 0 && <p className="mt-1.5 text-metadata text-muted">No matching places. If it isn&rsquo;t on Findmi yet, contact Findmi and we&rsquo;ll add it.</p>}
          </>
        )}
      </div>

      <div>
        <p className="text-metadata font-semibold text-secondary">How are you there?</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {AVAILABILITY_RELATIONSHIPS.map((r) => (
            <button key={r} type="button" aria-pressed={relationship === r} onClick={() => setRelationship(r)} className={`h-9 rounded-full px-3.5 text-metadata font-semibold transition ${relationship === r ? "bg-findmi-50 text-findmi-700 ring-1 ring-findmi/40" : "bg-black/[0.04] text-muted hover:text-primary"}`}>
              {AVAILABILITY_RELATIONSHIP_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-metadata font-semibold text-secondary">What? <span className="font-normal text-muted">(Leave empty for your Brand generally)</span></p>
        {products.length === 0 ? (
          <p className="mt-1 text-metadata text-muted">Add products to your catalog to be specific.</p>
        ) : (
          <div className="mt-1.5 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            {products.map((p) => (
              <button key={p.id} type="button" aria-pressed={productIds.includes(p.id)} onClick={() => toggleProduct(p.id)} className={`h-8 max-w-full truncate rounded-full px-3 text-metadata font-semibold transition ${productIds.includes(p.id) ? "bg-findmi-50 text-findmi-700 ring-1 ring-findmi/40" : "bg-black/[0.04] text-muted hover:text-primary"}`}>
                {p.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="text-metadata font-semibold text-secondary">When?</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {([["ongoing", "Ongoing"], ["temporary", "Until A Date"], ["date_range", "Date Range"]] as const).map(([v, label]) => (
            <button key={v} type="button" aria-pressed={timing === v} onClick={() => setTiming(v)} className={`h-9 rounded-full px-3.5 text-metadata font-semibold transition ${timing === v ? "bg-findmi-50 text-findmi-700 ring-1 ring-findmi/40" : "bg-black/[0.04] text-muted hover:text-primary"}`}>
              {label}
            </button>
          ))}
        </div>
        {timing !== "ongoing" && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            {timing === "date_range" && (
              <label className="block text-metadata font-semibold text-secondary">Start
                <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className={`mt-1 ${inputClass}`} />
              </label>
            )}
            <label className={`block text-metadata font-semibold text-secondary ${timing === "temporary" ? "col-span-2" : ""}`}>{timing === "temporary" ? "Until" : "End"}
              <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className={`mt-1 ${inputClass}`} />
            </label>
          </div>
        )}
      </div>

      <label className="block text-metadata font-semibold text-secondary">Note <span className="font-normal text-muted">(Optional)</span>
        <input type="text" autoCapitalize="sentences" maxLength={AVAILABILITY_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Coffee counter, ground floor" className={`mt-1 ${inputClass}`} />
      </label>

      {error && <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-metadata font-semibold text-red-700">{error}</p>}
      <p className="text-microcopy text-subtle">
        {editing
          ? initial?.status === "live"
            ? "Saving changes sends this back to Findmi for review. It won\u2019t show publicly until it\u2019s approved again."
            : "Saving changes sends this to Findmi for review."
          : "Findmi reviews new places before they show on your public profile."}
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={onDone} className="h-11 rounded-full border border-black/10 px-5 text-button font-semibold text-primary hover:border-black/20">Cancel</button>
        <button type="button" disabled={pending} onClick={submit} className="h-11 flex-1 rounded-full bg-findmi px-5 text-button font-bold text-white transition hover:bg-findmi-600 disabled:opacity-60">
          {pending ? "Saving…" : editing ? "Save & Resubmit" : "Submit For Review"}
        </button>
      </div>
    </div>
  );
}
