"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import NavIcon from "@/components/NavIcon";
import {
  AVAILABILITY_NOTE_MAX,
  AVAILABILITY_RELATIONSHIPS,
  AVAILABILITY_RELATIONSHIP_HINTS,
  AVAILABILITY_RELATIONSHIP_LABELS,
  AVAILABILITY_SOURCE_LABELS,
  AVAILABILITY_STATUS_LABELS,
  availabilityRelationshipsPhrase,
  availabilityTiming,
  availabilityWhenLabel,
  normalizeAvailabilityRelationships,
  statusAfterOwnerEdit,
  type AvailabilityRelationship,
  type AvailabilityTiming,
} from "@/lib/business-availability-domain";
import { applyProductSet, isProductSetFullySelected, type ProductSet } from "@/lib/business-product-sets-domain";
import { isEmptyAvailabilityFilter, type AvailabilityFilter } from "@/lib/business-availability-bulk-domain";
import type { OwnerAvailabilityItem } from "@/lib/business-availability-owner";
import {
  createProductSetAction,
  deleteProductSetAction,
  removeAvailabilityAction,
  requestAvailabilityAction,
  searchLocationsForAvailability,
  updateAvailabilityAction,
  updateProductSetAction,
} from "../availability-actions";
import { Chip } from "../../../owner-ui";
import FindUsBulk from "./FindUsBulk";
import ProductSetsPanel from "./ProductSetsPanel";

type Place = { id: string; name: string; address?: string | null; city: string | null; state: string | null };

const STATUS_TONE = { live: "aqua", pending: "amber", declined: "neutral" } as const;

/** Findmi Here → Find Us Here: where people can find this Business's
 * products and services OUTSIDE its own Locations and dated Events — a
 * retailer that stocks it, a café that serves it, a venue that features it.
 * Each entry says WHERE (a canonical Location), HOW (any combination of
 * stocked / sold / served / featured / sampled — one place, one entry), WHAT (which Products — none = the Brand),
 * WHEN (ongoing, a date range, or until a date), and carries a STATUS
 * (Pending Review → Live) and SOURCE (added by the Business / verified by
 * Findmi). Only Live, in-effect entries show on the public profile.
 *
 * Built for a footprint of hundreds or thousands: the list is one server-side page
 * at a time, searchable and filterable by status / relationship / imported, and any
 * selection (a few rows, a page, or everything matching a filter) can be changed in
 * bulk. Filters live in the URL (fq / fs / fr / fi / fp), so Back, Forward and a
 * shared link all keep the same view. */
export default function AvailableAtView({
  businessId,
  available,
  items,
  total,
  page,
  pageSize,
  counts,
  filter,
  products,
  productSets,
  productSetsAvailable,
  canEdit,
}: {
  businessId: string;
  /** false before the availability-details migration is applied. */
  available: boolean;
  /** The current page of entries (already filtered/searched by the server). */
  items: OwnerAvailabilityItem[];
  total: number;
  page: number;
  pageSize: number;
  /** Whole-footprint totals for the filter chips. */
  counts: { all: number; live: number; pending: number; declined: number; imported: number };
  filter: AvailabilityFilter;
  products: { id: string; name: string }[];
  /** The Business's saved Product Sets (template layer for the chooser). */
  productSets: ProductSet[];
  /** false before the Product Sets migration is applied. */
  productSetsAvailable: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [navPending, startNav] = useTransition();
  const [query, setQuery] = useState(filter.q);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);

  const filtered = !isEmptyAvailabilityFilter(filter);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const firstShown = total === 0 ? 0 : (page - 1) * pageSize + 1;

  /** Updates the URL filter params; any change resets to page 1 and clears the selection. */
  const go = (patch: Partial<Record<"fq" | "fs" | "fr" | "fi" | "fp", string | null>>, mode: "push" | "replace" = "push") => {
    const next = new URLSearchParams(searchParams.toString());
    if (!("fp" in patch)) next.delete("fp");
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setSelected(new Set());
    setAllMatching(false);
    startNav(() => (mode === "push" ? router.push : router.replace)(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  // Debounced search: the URL (and so the server read) changes once typing pauses.
  useEffect(() => {
    if (query.trim() === filter.q) return;
    const t = window.setTimeout(() => go({ fq: query.trim() || null }, "replace"), 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const remove = (id: string) =>
    startTransition(async () => {
      setError(null);
      const result = await removeAvailabilityAction(businessId, id);
      if (!result.ok) setError(result.error);
    });

  const toggle = (id: string) => {
    setAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const pageIds = items.map((i) => i.id);
  const pageAllSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const selectionCount = allMatching ? total : selected.size;
  const liveSelected = allMatching ? (filter.status === "live" ? total : null) : items.filter((i) => selected.has(i.id) && i.status === "live").length;
  const chip = (on: boolean) => `flex h-9 items-center gap-1.5 rounded-full px-3.5 text-metadata font-semibold transition ${on ? "bg-findmi text-white" : "bg-black/[0.04] text-muted hover:text-primary"}`;

  return (
    <div className="flex flex-col gap-5 lg:max-w-3xl">
      <div>
        <p className="min-w-0 text-body text-muted">Where people can find your products and services beyond your own locations — a retailer, café or venue that carries you.</p>
      </div>
      {canEdit && available && !adding && !editingId && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Add Locations">
          <button type="button" onClick={() => setAdding(true)} className="flex h-10 shrink-0 items-center rounded-full bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600">
            Add A Place
          </button>
          <Link href={`/account/business/${businessId}/import-locations`} className="flex h-10 shrink-0 items-center rounded-full border border-black/10 bg-white px-4 text-button font-semibold text-primary transition hover:border-findmi/40">
            Import Locations
          </Link>
          <Link href={`/account/business/${businessId}/import-locations/history`} className="flex h-10 shrink-0 items-center rounded-full border border-black/10 bg-white px-4 text-button font-semibold text-primary transition hover:border-findmi/40">
            Import History
          </Link>
          {/* Honest about what exists: a locator Sync needs a real connector. */}
          <span aria-disabled="true" className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-dashed border-black/15 px-4 text-button font-semibold text-subtle">
            Sync Existing Locator
            <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[11px] font-bold uppercase text-muted">Coming Soon</span>
          </span>
        </div>
      )}

      {canEdit && available && !adding && !editingId && productSetsAvailable && (
        <ProductSetsPanel businessId={businessId} products={products} sets={productSets} />
      )}

      {!available && <p className="text-body text-muted">This isn&rsquo;t available yet. Please check back soon.</p>}
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-metadata font-semibold text-red-700">{error}</p>}

      {adding && <PlaceForm businessId={businessId} products={products} productSets={productSets} productSetsAvailable={productSetsAvailable} onDone={() => setAdding(false)} />}

      {available && counts.all > 0 && !adding && !editingId && (
        <div className="flex flex-col gap-2.5" role="search" aria-label="Find your places">
          <input
            type="search"
            autoCapitalize="none"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your places by name, city or address"
            aria-label="Search your places"
            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-input text-primary placeholder:text-subtle focus:border-findmi/50 focus:outline-none focus:ring-2 focus:ring-findmi/20"
          />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status">
            {([["", "All", counts.all], ["live", "Live", counts.live], ["pending", "Pending Review", counts.pending], ["declined", "Declined", counts.declined]] as const).map(([v, label, n]) => (
              <button key={v || "all"} type="button" aria-pressed={filter.status === v} onClick={() => go({ fs: v || null })} className={chip(filter.status === v)}>
                {label} <span className="font-normal opacity-80">{n.toLocaleString()}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Relationship">
            <button type="button" aria-pressed={filter.relationship === ""} onClick={() => go({ fr: null })} className={chip(filter.relationship === "")}>Any Relationship</button>
            {AVAILABILITY_RELATIONSHIPS.map((r) => (
              <button key={r} type="button" aria-pressed={filter.relationship === r} onClick={() => go({ fr: filter.relationship === r ? null : r })} className={chip(filter.relationship === r)}>
                {AVAILABILITY_RELATIONSHIP_LABELS[r].replace(/ Here$/, "")}
              </button>
            ))}
            {counts.imported > 0 && (
              <button type="button" aria-pressed={filter.imported} onClick={() => go({ fi: filter.imported ? null : "1" })} className={chip(filter.imported)}>
                Imported <span className="font-normal opacity-80">{counts.imported.toLocaleString()}</span>
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-metadata text-muted">
            <span role="status">
              {total === 0 ? "No matching places" : `Showing ${firstShown.toLocaleString()}–${Math.min(total, page * pageSize).toLocaleString()} of ${total.toLocaleString()}`}
              {filtered && (
                <>
                  {" · "}
                  <button type="button" onClick={() => { setQuery(""); go({ fq: null, fs: null, fr: null, fi: null }); }} className="font-semibold text-accent hover:underline">Clear Filters</button>
                </>
              )}
            </span>
            {canEdit && (
              <button type="button" aria-pressed={selecting} onClick={() => { setSelecting((v) => !v); setSelected(new Set()); setAllMatching(false); }} className="font-semibold text-accent hover:underline">
                {selecting ? "Done Selecting" : "Select Places"}
              </button>
            )}
          </div>
          {selecting && items.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-black/[0.03] px-3 py-2 text-metadata">
              <label className="flex items-center gap-2 font-semibold text-secondary">
                <input type="checkbox" checked={pageAllSelected} onChange={() => { setAllMatching(false); setSelected(pageAllSelected ? new Set() : new Set(pageIds)); }} className="h-5 w-5 accent-findmi" />
                Select All On This Page
              </label>
              {pageAllSelected && total > pageIds.length && !allMatching && (
                <button type="button" onClick={() => setAllMatching(true)} className="font-semibold text-accent hover:underline">Select All {total.toLocaleString()} Matching</button>
              )}
              {allMatching && <span className="font-semibold text-findmi-700">All {total.toLocaleString()} matching places selected</span>}
            </div>
          )}
        </div>
      )}

      {available && items.length === 0 && !adding && (
        <p className="text-body text-muted">{counts.all === 0 ? "Nothing here yet. Add a retailer, café or venue where people can find you." : "No places match. Try a different search or clear the filters."}</p>
      )}

      {items.length > 0 && (
        <ul className={`flex flex-col divide-y divide-black/[0.06] transition-opacity ${navPending ? "opacity-60" : ""}`} aria-busy={navPending}>
          {items.map((i) =>
            editingId === i.id ? (
              <li key={i.id} className="py-3">
                <PlaceForm businessId={businessId} products={products} productSets={productSets} productSetsAvailable={productSetsAvailable} initial={i} onDone={() => setEditingId(null)} />
              </li>
            ) : (
            <li key={i.id} className="flex items-start gap-3 py-3">
              {selecting && (
                <input type="checkbox" checked={allMatching || selected.has(i.id)} onChange={() => toggle(i.id)} aria-label={`Select ${i.locationName}`} className="mt-4 h-5 w-5 shrink-0 accent-findmi" />
              )}
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
                  {availabilityRelationshipsPhrase(i.relationships)} · {availabilityWhenLabel(i.startsOn, i.endsOn)}
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
              {canEdit && !selecting && (
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

      {pages > 1 && !adding && !editingId && (
        <nav aria-label="Pages" className="flex items-center justify-between text-metadata font-semibold">
          <button type="button" disabled={page <= 1 || navPending} onClick={() => go({ fp: page - 1 > 1 ? String(page - 1) : null })} className="h-10 rounded-full border border-black/10 bg-white px-4 text-primary disabled:opacity-40">Previous</button>
          <span className="text-muted">Page {page.toLocaleString()} of {pages.toLocaleString()}</span>
          <button type="button" disabled={page >= pages || navPending} onClick={() => go({ fp: String(page + 1) })} className="h-10 rounded-full border border-black/10 bg-white px-4 text-primary disabled:opacity-40">Next</button>
        </nav>
      )}

      {selecting && selectionCount > 0 && (
        <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-20 lg:bottom-4">
          <FindUsBulk
            businessId={businessId}
            selectedIds={[...selected]}
            allMatching={allMatching}
            matchingTotal={total}
            filter={filter}
            liveSelected={liveSelected}
            products={products}
            productSets={productSets}
            onFinished={() => {}}
            onClear={() => { setSelected(new Set()); setAllMatching(false); }}
          />
        </div>
      )}
    </div>
  );
}

/** One form for both Add and Edit. Editing never changes the place (that is
 * the entry's identity — remove it and add the new one); everything else —
 * how, which Products, when, the note — is editable. Only a change that adds
 * a public claim (a way you’re there that wasn’t approved, or new note text)
 * sends it back to Pending Review (lib/business-availability-domain.ts
 * statusAfterOwnerEdit); the form says which, live, as you edit. */
function PlaceForm({
  businessId,
  products,
  productSets,
  productSetsAvailable,
  initial,
  onDone,
}: {
  businessId: string;
  products: { id: string; name: string }[];
  productSets: ProductSet[];
  productSetsAvailable: boolean;
  initial?: OwnerAvailabilityItem;
  onDone: () => void;
}) {
  const editing = Boolean(initial);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [place, setPlace] = useState<Place | null>(initial ? { id: initial.locationId, name: initial.locationName, city: initial.city, state: initial.state } : null);
  const [relationships, setRelationships] = useState<AvailabilityRelationship[]>(initial?.relationships ?? ["stocked"]);
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
    timer.current = window.setTimeout(async () => setResults(await searchLocationsForAvailability(businessId, query)), 180);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [query, place, businessId]);

  const submit = () =>
    startTransition(async () => {
      setError(null);
      if (!place) return setError("Choose where to find you.");
      if (relationships.length === 0) return setError("Choose at least one way you’re there.");
      const fields = {
        relationships,
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

  // The same rule the server applies — shown before saving, never a surprise after.
  const needsReview = initial
    ? statusAfterOwnerEdit(initial.status, { relationshipsBefore: initial.relationships, relationshipsAfter: relationships, noteBefore: initial.note, noteAfter: note || null }) === "pending" && initial.status !== "pending"
    : true;
  const toggleRelationship = (r: AvailabilityRelationship) =>
    setRelationships((prev) => normalizeAvailabilityRelationships(prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
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
            <input id="avail-place" type="search" autoComplete="off" autoCapitalize="none" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by place name or city" className={`mt-1 ${inputClass}`} />
            {results.length > 0 && (
              <ul role="listbox" aria-label="Locations" className="mt-1 max-h-56 overflow-y-auto rounded-xl border border-black/10 bg-white p-1">
                {results.map((r) => (
                  <li key={r.id}>
                    <button type="button" role="option" aria-selected={false} onClick={() => setPlace(r)} className="w-full rounded-lg px-3 py-2 text-left hover:bg-black/[0.03]">
                      <span className="block text-body text-primary">{r.name}</span>
                      <span className="block text-metadata text-muted">{[r.address, r.city, r.state].filter(Boolean).join(", ")}</span>
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
        <p id="avail-how" className="text-metadata font-semibold text-secondary">How are you there? <span className="font-normal text-muted">(Choose All That Apply)</span></p>
        <div role="group" aria-labelledby="avail-how" className="mt-1.5 flex flex-wrap gap-1.5">
          {AVAILABILITY_RELATIONSHIPS.map((r) => {
            const on = relationships.includes(r);
            return (
              <button
                key={r}
                type="button"
                aria-pressed={on}
                title={AVAILABILITY_RELATIONSHIP_HINTS[r]}
                onClick={() => toggleRelationship(r)}
                className={`flex h-9 items-center gap-1.5 rounded-full px-3.5 text-metadata font-semibold transition ${on ? "bg-findmi text-white" : "bg-black/[0.04] text-muted hover:text-primary"}`}
              >
                <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${on ? "bg-white/25" : "border border-black/20 text-transparent"}`}>
                  ✓
                </span>
                {AVAILABILITY_RELATIONSHIP_LABELS[r]}
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-microcopy text-subtle">
          {relationships.length === 0 ? "Pick at least one." : relationships.map((r) => AVAILABILITY_RELATIONSHIP_HINTS[r]).join(" · ")}
        </p>
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-metadata font-semibold text-secondary">Products</p>
          {products.length > 0 && (
            <span className="flex items-center gap-3 text-metadata">
              <span className="font-semibold text-muted">{productIds.length === 0 ? "None Selected" : `${productIds.length} Selected`}</span>
              <button type="button" onClick={() => setProductIds(productIds.length === products.length ? [] : products.map((p) => p.id))} className="font-semibold text-accent hover:underline">
                {productIds.length === products.length ? "Clear" : "Select All"}
              </button>
            </span>
          )}
        </div>
        <p className="text-microcopy text-subtle">Leave empty if this is your Brand generally.</p>
        {(productSetsAvailable || productSets.length > 0) && products.length > 0 && (
          <ProductSetsBar businessId={businessId} products={products} sets={productSets} selected={productIds} onChange={setProductIds} />
        )}
        {products.length === 0 ? (
          <p className="mt-1 text-metadata text-muted">Add products to your catalog to be specific.</p>
        ) : (
          <div className="mt-1.5 flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
            {products.map((p) => {
              const on = productIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleProduct(p.id)}
                  className={`flex h-9 max-w-full items-center gap-1.5 rounded-full px-3 text-metadata font-semibold transition ${on ? "bg-findmi text-white" : "bg-black/[0.04] text-muted hover:text-primary"}`}
                >
                  <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${on ? "bg-white/25" : "border border-black/20 text-transparent"}`}>
                    ✓
                  </span>
                  <span className="truncate">{p.name}</span>
                </button>
              );
            })}
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
          ? initial?.status === "pending"
            ? "This is still waiting for Findmi’s review. Your changes are included."
            : needsReview
              ? "You’ve added a way you’re there or new note text, so Findmi reviews this again. It won\u2019t show publicly until it\u2019s approved."
              : initial?.status === "declined"
                ? "Findmi didn\u2019t approve this place. Saving keeps it off your profile — add a new way you\u2019re there to submit it again."
                : "Products, dates and removing a way you’re there save right away. This stays live."
          : "Findmi reviews new places before they show on your public profile."}
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={onDone} className="h-11 rounded-full border border-black/10 px-5 text-button font-semibold text-primary hover:border-black/20">Cancel</button>
        <button type="button" disabled={pending} onClick={submit} className="h-11 flex-1 rounded-full bg-findmi px-5 text-button font-bold text-white transition hover:bg-findmi-600 disabled:opacity-60">
          {pending ? "Saving…" : !editing ? "Submit For Review" : needsReview ? "Save & Resubmit" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

/** Product Sets inside the Products chooser: apply a saved set (fills the
 * selection — adjust it freely for this one place), save the current
 * selection as a set, and manage saved sets. A set never changes what is
 * public by itself; the entry still saves the actual Products. */
export function ProductSetsBar({
  businessId,
  products,
  sets: initialSets,
  selected,
  onChange,
}: {
  businessId: string;
  products: { id: string; name: string }[];
  sets: ProductSet[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [sets, setSets] = useState(initialSets);
  const [saving, setSaving] = useState(false);
  const [managing, setManaging] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const known = new Set(products.map((p) => p.id));

  const saveCurrent = () =>
    startTransition(async () => {
      setError(null);
      const result = await createProductSetAction(businessId, { name, productIds: selected });
      if (!result.ok) return setError(result.error);
      setSets((prev) => [...prev, { id: result.id ?? name, name: name.trim(), productIds: [...selected] }].sort((a, b) => a.name.localeCompare(b.name)));
      setName("");
      setSaving(false);
    });
  const replaceWithSelection = (set: ProductSet) =>
    startTransition(async () => {
      setError(null);
      const result = await updateProductSetAction(businessId, set.id, { name: set.name, productIds: selected });
      if (!result.ok) return setError(result.error);
      setSets((prev) => prev.map((s) => (s.id === set.id ? { ...s, productIds: [...selected] } : s)));
    });
  const remove = (set: ProductSet) =>
    startTransition(async () => {
      setError(null);
      const result = await deleteProductSetAction(businessId, set.id);
      if (!result.ok) return setError(result.error);
      setSets((prev) => prev.filter((s) => s.id !== set.id));
    });

  return (
    <div className="mt-2 rounded-xl bg-black/[0.03] p-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-metadata font-semibold text-secondary">Product Sets</p>
        <span className="flex items-center gap-3 text-metadata">
          {selected.length > 0 && !saving && (
            <button type="button" onClick={() => setSaving(true)} className="font-semibold text-accent hover:underline">
              Save Selection As Set
            </button>
          )}
          {sets.length > 0 && (
            <button type="button" aria-expanded={managing} onClick={() => setManaging((m) => !m)} className="font-semibold text-muted hover:text-primary">
              {managing ? "Done" : "Manage"}
            </button>
          )}
        </span>
      </div>
      {sets.length === 0 && !saving && <p className="mt-0.5 text-microcopy text-subtle">Save a group of Products once and apply it to any place.</p>}
      {sets.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {sets.map((set) => {
            const live = set.productIds.filter((id) => known.has(id));
            const on = isProductSetFullySelected(selected, { productIds: live });
            return (
              <button
                key={set.id}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(applyProductSet(selected, { productIds: live }))}
                className={`h-8 max-w-full truncate rounded-full px-3 text-metadata font-semibold transition ${on ? "bg-findmi-50 text-findmi-700 ring-1 ring-findmi/40" : "bg-white text-muted ring-1 ring-black/10 hover:text-primary"}`}
              >
                {set.name} · {live.length}
              </button>
            );
          })}
        </div>
      )}
      {saving && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            autoCapitalize="words"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this set, e.g. Core Assortment"
            aria-label="Product Set name"
            className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3 py-2 text-input text-primary placeholder:text-subtle focus:border-findmi/50 focus:outline-none"
          />
          <button type="button" disabled={pending || !name.trim()} onClick={saveCurrent} className="h-9 rounded-full bg-findmi px-4 text-button font-bold text-white disabled:opacity-50">
            Save
          </button>
          <button type="button" onClick={() => { setSaving(false); setName(""); }} className="h-9 px-2 text-metadata font-semibold text-muted">
            Cancel
          </button>
        </div>
      )}
      {managing && (
        <ul className="mt-2 flex flex-col divide-y divide-black/[0.06]">
          {sets.map((set) => (
            <li key={set.id} className="flex items-center justify-between gap-3 py-1.5">
              <span className="min-w-0 truncate text-metadata text-secondary">{set.name} · {set.productIds.length}</span>
              <span className="flex shrink-0 items-center gap-3 text-metadata font-semibold">
                <button type="button" disabled={pending || selected.length === 0} onClick={() => replaceWithSelection(set)} className="text-accent hover:underline disabled:opacity-40">
                  Update To Selection
                </button>
                <button type="button" disabled={pending} onClick={() => remove(set)} className="text-muted hover:text-red-700 disabled:opacity-40">
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mt-2 text-metadata font-semibold text-red-700">{error}</p>}
    </div>
  );
}
