"use client";

import { useState } from "react";
import { TextField, TextareaField } from "@/components/admin/Fields";
import ImageField from "@/components/admin/ImageField";
import { RelationField, type SearchResult } from "@/components/admin/RelationPicker";
import HomepageBulletin from "@/components/HomepageBulletin";
import type { BulletinDestinationType, HomepageBulletin as BulletinRow } from "@/lib/homepage-bulletins";

const selectClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink focus:border-ink/30 focus:outline-none";

const DESTINATION_OPTIONS: { value: BulletinDestinationType | ""; label: string }[] = [
  { value: "", label: "None" },
  { value: "business", label: "A Business" },
  { value: "event", label: "An Event" },
  { value: "location", label: "A Location" },
  { value: "custom_url", label: "A custom link" },
];

/** Homepage Bulletin create/edit form — a plain Server Action form (same
 * pattern as NavItemCard/BusinessForm), with a few fields also mirrored
 * into local state so the preview panel (the SAME HomepageBulletin
 * component the public homepage renders, not a second styled copy) can
 * update live as the founder types. Destination Type is client-side for
 * the same reason NavItemCard's is: the right input (searchable picker
 * vs. a plain URL field) needs to show immediately. */
export default function BulletinForm({
  bulletin,
  initialDestination,
  previewHref,
  saveAction,
}: {
  bulletin: BulletinRow;
  /** Already-selected Business/Event/Location, if destination_id is set —
   * lets RelationField show what's chosen instead of an empty search box. */
  initialDestination: SearchResult | null;
  /** Resolved server-side from the bulletin's CURRENT saved destination —
   * the preview's link target. Only updates after a real save (see this
   * component's own header comment); an unsaved destination-type change
   * previews every other field live but keeps showing the last-saved link
   * target, which is enough for "does this look right" without a second,
   * client-side destination-resolution system. */
  previewHref: string | null;
  saveAction: (formData: FormData) => void;
}) {
  const [destinationType, setDestinationType] = useState<BulletinDestinationType | "">(bulletin.destination_type ?? "");
  const [eyebrow, setEyebrow] = useState(bulletin.eyebrow ?? "");
  const [headline, setHeadline] = useState(bulletin.headline);
  const [supportingText, setSupportingText] = useState(bulletin.supporting_text ?? "");
  const [metaText, setMetaText] = useState(bulletin.meta_text ?? "");
  const [thumbnailUrl, setThumbnailUrl] = useState(bulletin.thumbnail_url ?? "");
  const [ctaText, setCtaText] = useState(bulletin.cta_text ?? "");

  const relationEntity =
    destinationType === "business" ? "businesses" : destinationType === "event" ? "events" : destinationType === "location" ? "locations" : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <form action={saveAction} className="flex flex-col gap-3">
        <ImageField label="Thumbnail (optional)" name="thumbnail_url" defaultValue={bulletin.thumbnail_url} onChange={setThumbnailUrl} />
        <TextField
          label="Eyebrow (optional)"
          name="eyebrow"
          defaultValue={eyebrow}
          placeholder="e.g. WHAT'S HAPPENING, JUST ANNOUNCED, FEATURED"
          hint="Small label above the headline."
          onChange={setEyebrow}
        />
        <TextField label="Headline" name="headline" defaultValue={headline} required onChange={setHeadline} />
        <TextareaField label="Supporting text (optional)" name="supporting_text" defaultValue={supportingText} rows={2} onChange={setSupportingText} />
        <TextField
          label="Meta text (optional)"
          name="meta_text"
          defaultValue={metaText}
          placeholder="e.g. Sep 29 – Oct 1 · Hudson Yards"
          onChange={setMetaText}
        />
        <TextField
          label="CTA text (optional)"
          name="cta_text"
          defaultValue={ctaText}
          placeholder="e.g. Learn more, Explore, View event"
          onChange={setCtaText}
        />

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">Destination</span>
          <select
            name="destination_type"
            value={destinationType}
            onChange={(e) => setDestinationType(e.target.value as BulletinDestinationType | "")}
            className={selectClass}
          >
            {DESTINATION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-ink/45">
            Leave as None to show the Bulletin with no CTA — no dead link is ever shown.
          </span>
        </label>

        {relationEntity && (
          <RelationField
            // Remounts on a destination-type switch — RelationField owns
            // its own selection state internally, so without a key change,
            // switching types (e.g. Business -> Location) would keep
            // showing the previous type's stale selected item.
            key={destinationType}
            label={DESTINATION_OPTIONS.find((o) => o.value === destinationType)?.label ?? "Destination"}
            name="destination_id"
            entity={relationEntity}
            initial={destinationType === bulletin.destination_type ? initialDestination : null}
            clearLabel={null}
          />
        )}
        {destinationType === "custom_url" && (
          <TextField
            label="Custom link"
            name="destination_url"
            defaultValue={bulletin.destination_url}
            placeholder="/some-path or https://example.com"
            hint="Internal path starting with / or a link starting with https://."
          />
        )}

        <button
          type="submit"
          className="self-start rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Save
        </button>
      </form>

      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Preview</p>
        <div className="mt-2">
          <HomepageBulletin
            bulletin={{
              id: bulletin.id,
              eyebrow: eyebrow || null,
              headline: headline || "Headline",
              supportingText: supportingText || null,
              metaText: metaText || null,
              thumbnailUrl: thumbnailUrl || null,
              ctaText: ctaText || null,
              href: previewHref,
              destinationType: destinationType || null,
            }}
          />
        </div>
        <p className="mt-2 text-xs text-ink/40">
          Live as you type; the link target reflects the last saved destination until you Save again.
        </p>
      </div>
    </div>
  );
}
