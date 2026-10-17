"use client";

import { useState } from "react";
import { TextField, TextareaField, SelectField } from "@/components/admin/Fields";
import { EntitySearchAdd } from "@/components/admin/RelationPicker";
import SubmitBar from "@/components/admin/SubmitBar";
import {
  IDEA_AUDIENCES,
  IDEA_AUDIENCE_LABELS,
  IDEA_LIMITS,
  IDEA_STATUSES,
  IDEA_STATUS_LABELS,
  IDEA_TYPES,
  IDEA_TYPE_LABELS,
  type IdeaAudience,
} from "@/lib/brand-audit-domain";
import type { AdminIdea } from "@/lib/brand-audit";

/** Create / edit an Opportunity Idea: content, type, status, order and
 * audience (All Brands, or Selected Businesses picked with the shared
 * server-backed search). Every rule is re-validated server-side. */
export default function IdeaForm({
  idea,
  targets: initialTargets,
  action,
  saveLabel,
  cancelHref,
}: {
  idea: AdminIdea | null;
  targets: { id: string; name: string }[];
  action: (formData: FormData) => void | Promise<void>;
  saveLabel: string;
  cancelHref: string;
}) {
  const [audience, setAudience] = useState<IdeaAudience>(idea?.audience ?? "all_brands");
  const [targets, setTargets] = useState(initialTargets);

  return (
    <form action={action} className="flex max-w-2xl flex-col gap-4">
      <TextField label="Title" name="title" defaultValue={idea?.title} required hint={`Title Case. Up to ${IDEA_LIMITS.title} characters.`} />
      <TextareaField
        label="Short Description"
        name="summary"
        defaultValue={idea?.summary}
        rows={3}
        hint={`Shown on the card. Explain the strategy or channel — never claim venues, dates, pricing or inventory. Up to ${IDEA_LIMITS.summary} characters.`}
      />
      <TextareaField label="Longer Explanation (Optional)" name="details" defaultValue={idea?.details} rows={4} hint="Shown when a Brand opens the Idea." />
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField label="Type" name="idea_type" defaultValue={idea?.idea_type ?? "sampling"} options={IDEA_TYPES.map((t) => ({ value: t, label: IDEA_TYPE_LABELS[t] }))} />
        <SelectField label="Status" name="status" defaultValue={idea?.status ?? "draft"} options={IDEA_STATUSES.map((s) => ({ value: s, label: IDEA_STATUS_LABELS[s] }))} />
        <TextField label="Display Order" name="display_order" defaultValue={idea?.display_order ?? 100} hint="Lower shows first." />
      </div>

      <fieldset>
        <legend className="mb-1.5 block text-sm font-medium text-ink">Who Sees This Idea</legend>
        <div className="flex flex-wrap gap-2">
          {IDEA_AUDIENCES.map((a) => (
            <label
              key={a}
              className={`flex h-10 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-semibold transition ${audience === a ? "border-ink bg-ink text-white" : "border-black/10 bg-white text-ink/70 hover:border-black/20"}`}
            >
              <input type="radio" name="audience" value={a} checked={audience === a} onChange={() => setAudience(a)} className="sr-only" />
              {IDEA_AUDIENCE_LABELS[a]}
            </label>
          ))}
        </div>
        {audience === "selected_businesses" && (
          <div className="mt-3 rounded-xl border border-black/5 bg-white p-3">
            {targets.length > 0 ? (
              <ul className="mb-3 flex flex-wrap gap-1.5">
                {targets.map((t) => (
                  <li key={t.id} className="flex items-center gap-1 rounded-full bg-black/5 py-1 pl-3 pr-1 text-sm text-ink">
                    <input type="hidden" name="target_business_ids" value={t.id} />
                    {t.name}
                    <button
                      type="button"
                      aria-label={`Remove ${t.name}`}
                      onClick={() => setTargets((prev) => prev.filter((x) => x.id !== t.id))}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-ink/45 hover:bg-black/10 hover:text-ink"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-2 text-xs text-ink/45">No Businesses chosen yet.</p>
            )}
            <EntitySearchAdd
              entity="businesses"
              placeholder="Add a Business…"
              excludeIds={new Set(targets.map((t) => t.id))}
              onAdd={(r) => setTargets((prev) => [...prev, { id: r.value, name: r.label }])}
            />
          </div>
        )}
      </fieldset>

      <SubmitBar cancelHref={cancelHref} saveLabel={saveLabel} />
    </form>
  );
}
