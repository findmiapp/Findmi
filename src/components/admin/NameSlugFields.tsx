"use client";

import { useState } from "react";
import { slugify } from "@/lib/slug";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";

/** Paired Name + URL Slug fields shared by every admin create/edit form for
 * a publicly-routed entity (businesses, events, products, locations,
 * people, and — going forward — taxonomy records). WordPress-style
 * permalink behavior:
 *
 * - CREATE (isNew): the Slug field live-follows Name as it's typed, until
 *   the admin edits Slug directly — after that it stops following, so a
 *   deliberate override sticks.
 * - EDIT (!isNew): an already-established slug is never quietly changed
 *   just because Name changes — existing URLs keep working by default —
 *   but the admin can still edit Slug by hand when a change is genuinely
 *   needed.
 *
 * This is convenience only. The real safety net is server-side: every
 * Server Action that saves one of these entities re-normalizes the
 * submitted slug and falls back to generating one from the name if it's
 * blank (see lib/slug's resolveSlugInput/ensureUniqueSlug), so a broken or
 * blank slug can never reach the database even with JS disabled. */
export default function NameSlugFields({
  isNew,
  nameLabel = "Name",
  nameName = "name",
  defaultName,
  slugLabel = "URL Slug",
  slugName = "slug",
  defaultSlug,
  slugHint,
}: {
  isNew: boolean;
  nameLabel?: string;
  nameName?: string;
  defaultName?: string | null;
  slugLabel?: string;
  slugName?: string;
  defaultSlug?: string | null;
  slugHint?: string;
}) {
  const [slug, setSlug] = useState(defaultSlug ?? "");
  // Starts locked on EDIT (name changes must never touch an established
  // slug) and locks itself the moment the admin types into Slug directly
  // on CREATE, so a deliberate override always sticks.
  const [slugLocked, setSlugLocked] = useState(!isNew);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink">{nameLabel}</span>
        <input
          type="text"
          name={nameName}
          defaultValue={defaultName ?? ""}
          required
          onChange={(e) => {
            if (!slugLocked) setSlug(slugify(e.target.value));
          }}
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink">{slugLabel}</span>
        <input
          type="text"
          name={slugName}
          value={slug}
          onChange={(e) => {
            setSlugLocked(true);
            setSlug(e.target.value);
          }}
          className={inputClass}
        />
        <span className="mt-1 block text-xs text-ink/45">
          {slugHint ?? "Auto-generated from the name — edit only if you need a specific URL."}
        </span>
      </label>
    </div>
  );
}
