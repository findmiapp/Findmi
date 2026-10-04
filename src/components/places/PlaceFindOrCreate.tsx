"use client";

import { useState, useTransition } from "react";
import FindOrCreatePicker from "@/components/find-or-create/FindOrCreatePicker";
import { useAccountSearch, type AccountSearchResult } from "@/components/account/useAccountSearch";
import type { SelectedLocationDetail } from "@/components/account/EventLocationField";
import type { CreateInlineLocationResult } from "@/lib/locationCreation";
import { createInlinePlace } from "@/app/(public)/account/location/actions";

/** Find-or-Create V1 — the PLACE adapter for FindOrCreatePicker: search
 * linkable Findmi places (published + known-but-not-yet-public, never
 * archived/trashed — /api/account/search scope=place), and when the place
 * isn't there, add it inline with its minimum physical identity.
 *
 * Adding a place here means only "this physical place exists": the default
 * createInlinePlace never grants location membership and never creates a
 * Business Location (see its doc comment). Callers with different
 * authorization (Admin) pass their own createAction. */

export function placeResultToDetail(r: AccountSearchResult): SelectedLocationDetail {
  return {
    id: r.value,
    name: r.label,
    slug: r.slug ?? "",
    category: r.category ?? null,
    address: r.address ?? null,
    city: r.city ?? null,
    state: r.state ?? null,
    postal_code: r.postal_code ?? null,
    is_public: r.is_public,
  };
}

function usePlaceResults(query: string) {
  const { results, loading } = useAccountSearch("locations", query, { browseEmpty: true, scope: "place" });
  return { results: results.map(placeResultToDetail), loading };
}

function normalizeName(v: string) {
  return v.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function placeLine(p: Pick<SelectedLocationDetail, "address" | "city" | "state">): string {
  return [p.address, [p.city, p.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
}

export function NotPublicBadge() {
  return (
    <span className="shrink-0 rounded-full bg-black/[0.05] px-2 py-0.5 text-label font-bold uppercase text-muted">Not public yet</span>
  );
}

function PlaceRow({ place }: { place: SelectedLocationDetail }) {
  const line = placeLine(place);
  return (
    <span className="flex min-w-0 flex-1 items-start gap-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-semibold text-primary">{place.name}</span>
        {line && <span className="block truncate text-metadata text-muted">{line}</span>}
      </span>
      {place.is_public === false && <NotPublicBadge />}
    </span>
  );
}

export default function PlaceFindOrCreate({
  onSelect,
  createAction = createInlinePlace,
  placeholder = "Search places — name, street or city",
  autoFocus = false,
}: {
  onSelect: (place: SelectedLocationDetail) => void;
  createAction?: (formData: FormData) => Promise<CreateInlineLocationResult>;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <FindOrCreatePicker<SelectedLocationDetail>
      placeholder={placeholder}
      useResults={usePlaceResults}
      getKey={(p) => p.id}
      renderItem={(p) => <PlaceRow place={p} />}
      isExactMatch={(p, q) => normalizeName(p.name) === normalizeName(q)}
      onPick={onSelect}
      autoFocus={autoFocus}
      renderCreate={({ initialName, onDone }) => (
        <PlaceCreatePanel
          initialName={initialName}
          createAction={createAction}
          onCancel={onDone}
          onSelected={(place) => {
            onSelect(place);
            onDone();
          }}
        />
      )}
    />
  );
}

const fieldClass =
  "h-12 w-full rounded-xl border border-black/10 bg-white px-3.5 text-input text-primary placeholder:text-subtle focus:border-findmi/50 focus:outline-none focus:ring-2 focus:ring-findmi/20";

/** The minimum physical identity of a place — not its public profile. */
function PlaceCreatePanel({
  initialName,
  createAction,
  onCancel,
  onSelected,
}: {
  initialName: string;
  createAction: (formData: FormData) => Promise<CreateInlineLocationResult>;
  onCancel: () => void;
  onSelected: (place: SelectedLocationDetail) => void;
}) {
  const [form, setForm] = useState({ name: initialName, address: "", city: "", state: "", postal_code: "" });
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<SelectedLocationDetail[] | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(force: boolean) {
    if (!form.name.trim() || !form.address.trim() || !form.city.trim() || !form.state.trim()) {
      setError("Add the name, street address, city and state.");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("name", form.name.trim());
    fd.set("address", form.address.trim());
    fd.set("city", form.city.trim());
    fd.set("state", form.state.trim());
    fd.set("postal_code", form.postal_code.trim());
    if (force) fd.set("force", "1");
    startTransition(async () => {
      const result = await createAction(fd);
      if (result.status === "error") setError(result.error);
      else if (result.status === "duplicates") setCandidates(result.duplicates);
      else onSelected(result.location);
    });
  }

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setCandidates(null);
  };
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-findmi/30 bg-findmi-50/40 p-3.5 sm:p-4">
      <div>
        <p className="text-card-title font-semibold text-primary">Add a place</p>
        <p className="mt-0.5 text-metadata text-muted">
          Just enough to identify it. It&rsquo;s added to Findmi as a place you can use right away — it doesn&rsquo;t make
          you its manager.
        </p>
      </div>

      {candidates && candidates.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-body font-semibold text-primary">Is this the place?</p>
          <ul className="flex flex-col gap-2">
            {candidates.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-xl border border-black/10 bg-white p-3">
                <PlaceRow place={c} />
                <button
                  type="button"
                  onClick={() => onSelected(c)}
                  className="flex h-10 shrink-0 items-center rounded-full bg-findmi px-4 text-metadata font-bold text-white transition hover:bg-findmi-600"
                >
                  Use this place
                </button>
              </li>
            ))}
          </ul>
          <p className="text-metadata text-muted">Places can share a street address (hotels, malls, food halls).</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => submit(true)}
              disabled={pending}
              className="flex h-10 items-center rounded-full border border-black/10 bg-white px-4 text-metadata font-semibold text-secondary transition hover:border-black/20 disabled:opacity-50"
            >
              {pending ? "Adding…" : `Add "${form.name.trim()}" as a new place`}
            </button>
            <button type="button" onClick={() => setCandidates(null)} className="h-10 px-2 text-metadata font-semibold text-muted hover:text-primary">
              Edit details
            </button>
          </div>
        </div>
      ) : (
        <>
          <label className="block">
            <span className="mb-1 block text-metadata font-medium text-secondary">Place name</span>
            <input type="text" value={form.name} onChange={set("name")} onKeyDown={onEnter} className={fieldClass} />
          </label>
          <label className="block">
            <span className="mb-1 block text-metadata font-medium text-secondary">Street address</span>
            <input type="text" value={form.address} onChange={set("address")} onKeyDown={onEnter} autoComplete="street-address" autoFocus className={fieldClass} />
          </label>
          <div className="grid grid-cols-[minmax(0,1fr)_4.5rem] gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_6.5rem]">
            <label className="block">
              <span className="mb-1 block text-metadata font-medium text-secondary">City</span>
              <input type="text" value={form.city} onChange={set("city")} onKeyDown={onEnter} autoComplete="address-level2" className={fieldClass} />
            </label>
            <label className="block">
              <span className="mb-1 block text-metadata font-medium text-secondary">State</span>
              <input type="text" value={form.state} onChange={set("state")} onKeyDown={onEnter} autoComplete="address-level1" className={fieldClass} />
            </label>
            <label className="col-span-2 block sm:col-span-1">
              <span className="mb-1 block text-metadata font-medium text-secondary">
                ZIP <span className="font-normal text-subtle">optional</span>
              </span>
              <input type="text" inputMode="numeric" value={form.postal_code} onChange={set("postal_code")} onKeyDown={onEnter} autoComplete="postal-code" className={fieldClass} />
            </label>
          </div>
          {error && <p className="text-metadata text-red-600">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => submit(false)}
              disabled={pending}
              className="flex h-11 items-center rounded-full bg-findmi px-5 text-button font-bold text-white transition hover:bg-findmi-600 disabled:opacity-50"
            >
              {pending ? "Adding…" : "Add place"}
            </button>
            <button type="button" onClick={onCancel} className="h-11 px-3 text-button font-semibold text-muted hover:text-primary">
              Cancel
            </button>
          </div>
        </>
      )}
      {candidates && candidates.length > 0 && error && <p className="text-metadata text-red-600">{error}</p>}
    </div>
  );
}
