"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { TargetKind } from "@/lib/commercial-intents";
import {
  MAX_PUBLIC_ACTIONS,
  PUBLIC_ACTIONS_BY_KIND,
  PUBLIC_ACTION_DEFAULT_LABELS,
  PUBLIC_ACTION_LABEL_MAX,
  PUBLIC_ACTION_TYPE_LABELS,
  actionBarLayout,
  validateActionLabel,
  type PublicActionConfig,
  type PublicActionType,
} from "@/lib/public-actions-domain";
import { savePublicActionsAction } from "@/app/(public)/account/public-actions-actions";

type Draft = { key: number; type: PublicActionType; label: string; enabled: boolean; opportunityListingId: string | null };

/** Public Actions settings — up to three buttons visitors see under this
 * profile's identity, and the ONLY thing that shows them. The action type
 * decides what happens; the label only changes the words. Compact on
 * purpose: add, reorder, relabel, switch off. Saving never changes another
 * setting (e.g. it never turns Inquiries on) — a dependency is explained. */
export default function PublicActionsEditor({
  kind,
  entityId,
  initial,
  ready,
  opportunities,
  unavailable = {},
  defaultNote = "No actions yet, so visitors see no buttons. Add one to give them a clear way to reach you.",
  inquirySettingsHref,
}: {
  kind: TargetKind;
  entityId: string;
  initial: PublicActionConfig[];
  /** The store exists (false until the Public Actions migration is applied). */
  ready: boolean;
  /** Open Opportunities about this page an Opportunity action can open. */
  opportunities: { id: string; title: string }[];
  /** Types saved but not shown right now, with why (e.g. Inquiries off). */
  unavailable?: Partial<Record<PublicActionType, string>>;
  /** Shown when nothing is configured. */
  defaultNote?: string;
  /** Where Inquiry settings live (linked from the General Inquiry dependency). */
  inquirySettingsHref?: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Draft[]>(() => initial.map((a, i) => ({ key: i, type: a.type, label: a.label ?? "", enabled: a.enabled, opportunityListingId: a.opportunityListingId })));
  const [nextKey, setNextKey] = useState(initial.length);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const types = PUBLIC_ACTIONS_BY_KIND[kind].filter((t) => t !== "opportunity" || opportunities.length > 0);

  const update = (key: number, patch: Partial<Draft>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) =>
    setRows((r) => {
      const n = [...r];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });
  const add = () => {
    const used = new Set(rows.map((r) => r.type));
    const type = types.find((t) => !used.has(t)) ?? types[0];
    setRows((r) => [...r, { key: nextKey, type, label: "", enabled: true, opportunityListingId: type === "opportunity" ? (opportunities[0]?.id ?? null) : null }]);
    setNextKey((k) => k + 1);
  };
  const labelErrors = rows.map((r) => {
    const v = validateActionLabel(r.label);
    return v.ok ? null : v.error;
  });
  const shown = rows.filter((r) => r.enabled && !unavailable[r.type]);
  const { cols, compact } = actionBarLayout(shown.length);

  const save = () =>
    start(async () => {
      setStatus(null);
      const res = await savePublicActionsAction(
        kind,
        entityId,
        rows.map((r) => ({ type: r.type, label: r.label, enabled: r.enabled, opportunityListingId: r.type === "opportunity" ? r.opportunityListingId : null }))
      );
      if (!res.ok) return setStatus({ tone: "error", text: res.error });
      setStatus({ tone: "ok", text: "Saved. Your page shows these now." });
      router.refresh();
    });

  const field = "h-10 w-full min-w-0 rounded-xl border border-black/10 bg-white px-3 text-sm text-ink focus:border-ink/30 focus:outline-none";
  return (
    <section id="public-actions" className="scroll-mt-24 rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
      <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Public Actions</p>
      <p className="mt-1 text-sm text-ink/60">Choose up to {MAX_PUBLIC_ACTIONS} actions visitors can take from your profile.</p>
      {!ready && <p className="mt-3 rounded-xl bg-black/[0.03] px-3.5 py-2.5 text-sm text-ink/60">Public Actions are almost ready. Check back soon.</p>}
      {ready && !rows.length && defaultNote && <p className="mt-3 text-sm text-ink/60">{defaultNote}</p>}

      <ol className="mt-4 flex flex-col gap-3">
        {rows.map((r, i) => (
          <li key={r.key} className="flex flex-col gap-2 rounded-2xl border border-black/[0.08] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-ink/40">Action {i + 1}</span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0 || pending} aria-label="Move up" className="flex h-8 w-8 items-center justify-center rounded-full text-ink/50 hover:bg-black/[0.04] disabled:opacity-30">
                  ↑
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1 || pending} aria-label="Move down" className="flex h-8 w-8 items-center justify-center rounded-full text-ink/50 hover:bg-black/[0.04] disabled:opacity-30">
                  ↓
                </button>
                <button type="button" onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))} disabled={pending} className="flex h-8 items-center px-2 text-xs font-semibold text-ink/50 hover:text-red-700">
                  Remove
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
              <label className="flex min-w-0 flex-col gap-1">
                <span className="text-xs font-semibold text-ink/60">Action</span>
                <select
                  value={r.type}
                  onChange={(e) => {
                    const type = e.target.value as PublicActionType;
                    update(r.key, { type, opportunityListingId: type === "opportunity" ? (r.opportunityListingId ?? opportunities[0]?.id ?? null) : null });
                  }}
                  className={field}
                >
                  {types.map((t) => (
                    <option key={t} value={t}>
                      {PUBLIC_ACTION_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-0 flex-col gap-1">
                <span className="text-xs font-semibold text-ink/60">Button Label</span>
                <input
                  value={r.label}
                  onChange={(e) => update(r.key, { label: e.target.value })}
                  placeholder={PUBLIC_ACTION_DEFAULT_LABELS[r.type]}
                  maxLength={PUBLIC_ACTION_LABEL_MAX}
                  autoCapitalize="words"
                  className={field}
                />
              </label>
            </div>
            {r.type === "opportunity" && (
              <label className="flex min-w-0 flex-col gap-1">
                <span className="text-xs font-semibold text-ink/60">Opportunity</span>
                <select value={r.opportunityListingId ?? ""} onChange={(e) => update(r.key, { opportunityListingId: e.target.value || null })} className={field}>
                  {opportunities.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {labelErrors[i] && <p className="text-xs font-semibold text-red-700">{labelErrors[i]}</p>}
            {unavailable[r.type] && (
              <p className="text-xs font-semibold text-amber-700">
                {unavailable[r.type]}{" "}
                {r.type === "general_inquiry" && inquirySettingsHref && (
                  <Link href={inquirySettingsHref} className="text-findmi-700 underline">
                    Inquiry Settings
                  </Link>
                )}
              </p>
            )}
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={r.enabled} onChange={(e) => update(r.key, { enabled: e.target.checked })} className="h-4 w-4 accent-findmi" />
              Visible
            </label>
          </li>
        ))}
      </ol>

      {rows.length < MAX_PUBLIC_ACTIONS && (
        <button type="button" onClick={add} disabled={!ready || pending} className="mt-3 flex h-10 items-center rounded-full border border-findmi/40 px-4 text-sm font-bold text-findmi-700 hover:bg-findmi-50 disabled:opacity-50">
          + Add Action
        </button>
      )}

      {shown.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-ink/60">Preview</p>
          <div className={`mt-1.5 grid gap-2 ${cols === 3 ? "grid-cols-3" : cols === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
            {shown.map((r) => {
              const v = validateActionLabel(r.label);
              const text = (v.ok ? v.value : null) ?? PUBLIC_ACTION_DEFAULT_LABELS[r.type];
              return (
                <span
                  key={r.key}
                  className={`flex h-12 min-w-0 items-center justify-center rounded-2xl border border-findmi/40 bg-white text-center font-bold uppercase leading-tight text-findmi-700 [text-wrap:balance] ${compact ? "px-1.5 text-[11px] tracking-normal" : "px-3 text-sm tracking-wide"}`}
                >
                  {text}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {status && <p className={`mt-3 text-sm font-semibold ${status.tone === "ok" ? "text-findmi-700" : "text-red-700"}`}>{status.text}</p>}
      <button type="button" onClick={save} disabled={!ready || pending || labelErrors.some(Boolean)} className="mt-4 flex h-11 items-center rounded-2xl bg-findmi px-5 text-sm font-bold text-white hover:bg-findmi-600 disabled:opacity-50">
        {pending ? "Saving…" : "Save Public Actions"}
      </button>
    </section>
  );
}
