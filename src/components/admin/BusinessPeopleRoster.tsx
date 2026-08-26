"use client";

import { useState } from "react";
import { Avatar, EntitySearchAdd, type SearchResult } from "./RelationPicker";
import type { BusinessPersonRow } from "@/lib/admin/people-queries";

const inputClass =
  "rounded-lg border border-black/10 bg-white px-2.5 py-2 text-sm text-ink focus:border-ink/30 focus:outline-none";

interface Row {
  person_id: string;
  person_name: string;
  image_url: string | null;
  is_public: boolean;
  role: string;
  display_order: string;
  featured: boolean;
  show_on_business: boolean;
}

function toRow(p: BusinessPersonRow): Row {
  return {
    person_id: p.person_id,
    person_name: p.person_name,
    image_url: p.image_url,
    is_public: p.is_public,
    role: p.role ?? "",
    display_order: p.display_order != null ? String(p.display_order) : "",
    featured: p.featured,
    show_on_business: p.show_on_business,
  };
}

/** Search-and-add roster of the people shown on this business's public
 * profile — mirrors PersonBusinessRoster's person/business pattern
 * exactly, swapped to business/person. Posts into saveBusiness the same
 * way PersonBusinessRoster posts into savePerson: person_id (repeated,
 * one per row), role_$/display_order_$/featured_$/show_on_business_$
 * keyed by person id, and removed_person_id for anyone taken off this
 * roster. "Remove" here only detaches this person from THIS business
 * (deletes the one business_people row) — it never touches the person's
 * own profile, which lives at /admin/people and is a separate action. */
export default function BusinessPeopleRoster({
  initialPeople,
}: {
  initialPeople: BusinessPersonRow[];
}) {
  const [rows, setRows] = useState<Row[]>(initialPeople.map(toRow));
  const [removedIds, setRemovedIds] = useState<string[]>([]);

  const addPerson = (r: SearchResult) => {
    setRows((prev) => [
      ...prev,
      {
        person_id: r.value,
        person_name: r.label,
        image_url: r.image_url ?? null,
        is_public: true,
        role: "",
        display_order: "",
        featured: false,
        show_on_business: true,
      },
    ]);
    setRemovedIds((prev) => prev.filter((id) => id !== r.value));
  };

  const removePerson = (personId: string) => {
    setRows((prev) => prev.filter((row) => row.person_id !== personId));
    setRemovedIds((prev) => [...prev, personId]);
  };

  const updateRow = (personId: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((row) => (row.person_id === personId ? { ...row, ...patch } : row)));
  };

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-ink">People Behind This Business</span>
      <p className="mb-3 text-xs text-ink/45">
        Add the founders, owners, makers or team members you want shown on this business profile.
        &ldquo;Remove&rdquo; only takes someone off this one business — it never deletes their FindMi
        profile or removes them from any other business they&rsquo;re attached to.
      </p>

      <EntitySearchAdd
        entity="people"
        placeholder="Search and add a person…"
        excludeIds={new Set(rows.map((r) => r.person_id))}
        onAdd={addPerson}
      />

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink/45">Nobody added yet — search above to add someone.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {rows.map((row) => (
            <div key={row.person_id} className="rounded-xl border border-black/10 bg-white p-3">
              <input type="hidden" name="person_id" value={row.person_id} />
              <div className="flex items-center gap-2.5">
                <Avatar url={row.image_url} label={row.person_name} />
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{row.person_name}</p>
                <button
                  type="button"
                  onClick={() => removePerson(row.person_id)}
                  className="shrink-0 text-xs font-semibold text-red-600 hover:underline"
                >
                  Remove
                </button>
              </div>

              {!row.is_public && (
                <p className="mt-1.5 text-xs text-amber-700">
                  This person is currently hidden site-wide (Public is off on their FindMi profile) — they
                  won&rsquo;t actually show here until that&rsquo;s turned back on in People.
                </p>
              )}

              <div className="mt-2.5 grid gap-2 sm:grid-cols-[1fr_auto]">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-ink/60">Role / Title at this business</span>
                  <input
                    type="text"
                    name={`role_${row.person_id}`}
                    value={row.role}
                    onChange={(e) => updateRow(row.person_id, { role: e.target.value })}
                    placeholder="e.g. Founder, Head Chef, Co-Owner"
                    className={`${inputClass} w-full`}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-ink/60">Reorder</span>
                  <input
                    type="number"
                    name={`display_order_${row.person_id}`}
                    value={row.display_order}
                    onChange={(e) => updateRow(row.person_id, { display_order: e.target.value })}
                    placeholder="0"
                    title="Lower numbers show first"
                    className={`${inputClass} w-20`}
                  />
                </label>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-ink/70">
                  <input
                    type="checkbox"
                    name={`show_on_business_${row.person_id}`}
                    checked={row.show_on_business}
                    onChange={(e) => updateRow(row.person_id, { show_on_business: e.target.checked })}
                    className="h-4 w-4 accent-findmi"
                  />
                  Show on this business profile
                </label>
                <label className="flex items-center gap-1.5 text-xs text-ink/70">
                  <input
                    type="checkbox"
                    name={`featured_${row.person_id}`}
                    checked={row.featured}
                    onChange={(e) => updateRow(row.person_id, { featured: e.target.checked })}
                    className="h-4 w-4 accent-findmi"
                  />
                  Featured
                </label>
              </div>
            </div>
          ))}
        </div>
      )}

      {removedIds.map((id) => (
        <input key={id} type="hidden" name="removed_person_id" value={id} />
      ))}
    </div>
  );
}
