"use client";

import { useRef, useState } from "react";
import { useAdminSearch, type AdminSearchEntity, type SearchResult } from "@/components/admin/useAdminSearch";
import { processMediaRow, previewMediaRow } from "./actions";

type EntityType = "location" | "event" | "business";
type Target = "cover" | "logo";
type Status = "idle" | "previewing" | "processing" | "done" | "error";

interface Row {
  key: number;
  entityType: EntityType;
  entity: { id: string; label: string; sublabel?: string } | null;
  target: Target;
  url: string;
  preview: string | null;
  status: Status;
  message: string | null;
  /** A pasted row's entity match that needs a human look. */
  matchNote: string | null;
  selected: boolean;
}

const ENTITY_LABELS: Record<EntityType, string> = { location: "Place", event: "Event", business: "Business" };
const SEARCH_ENTITY: Record<EntityType, AdminSearchEntity> = { location: "locations", event: "events", business: "businesses" };
const TARGETS: Record<EntityType, Target[]> = { location: ["cover", "logo"], event: ["cover"], business: ["cover", "logo"] };

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";
const primaryButton =
  "rounded-full bg-ink px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-ink/85 disabled:opacity-50";
const secondaryButton =
  "rounded-full border border-black/10 bg-white px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-ink transition hover:border-black/25 disabled:opacity-50";

let nextKey = 1;
const newRow = (over: Partial<Row> = {}): Row => ({
  key: nextKey++,
  entityType: "location",
  entity: null,
  target: "cover",
  url: "",
  preview: null,
  status: "idle",
  message: null,
  matchNote: null,
  selected: true,
  ...over,
});

const rowId = (r: Row) => (r.entity ? `${r.entityType}:${r.entity.id}:${r.target}` : null);

/** "Place | Liberty Science Center | cover | https://…" (tab, | or ; separated). */
function parseType(raw: string): EntityType | null {
  const t = raw.trim().toLowerCase();
  if (["place", "location", "venue"].includes(t)) return "location";
  if (t === "event") return "event";
  if (["business", "brand"].includes(t)) return "business";
  return null;
}

async function resolveEntity(type: EntityType, name: string): Promise<{ entity: Row["entity"]; note: string | null }> {
  try {
    const res = await fetch(`/admin/api/search?entity=${SEARCH_ENTITY[type]}&q=${encodeURIComponent(name)}`);
    const data = (await res.json()) as { results?: SearchResult[] };
    const results = data.results ?? [];
    const exact = results.filter((r) => r.label.trim().toLowerCase() === name.trim().toLowerCase());
    const pick = exact.length === 1 ? exact[0] : results[0];
    if (!pick) return { entity: null, note: `No ${ENTITY_LABELS[type]} found for “${name}”.` };
    const note = exact.length === 1 ? null : exact.length > 1 ? "Several exact matches — check this is the right one." : "Closest match — check it.";
    return { entity: { id: pick.value, label: pick.label, sublabel: pick.sublabel }, note };
  } catch {
    return { entity: null, note: "Couldn't search for this record." };
  }
}

export default function MediaEnrichmentTable() {
  const [rows, setRows] = useState<Row[]>(() => [newRow()]);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // The same record + target twice in this table: only the first is processed.
  const firstByTarget = new Map<string, number>();
  for (const r of rows) {
    const id = rowId(r);
    if (id && !firstByTarget.has(id)) firstByTarget.set(id, r.key);
  }
  const isDuplicate = (r: Row) => {
    const id = rowId(r);
    return id !== null && firstByTarget.get(id) !== r.key;
  };

  async function importPasted() {
    const lines = paste.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const parsed: Row[] = [];
    for (const line of lines) {
      const cells = line.split(/\t|\s\|\s|\||;/).map((c) => c.trim());
      if (cells.length < 4) {
        parsed.push(newRow({ status: "error", message: `Couldn't read: “${line}” — use type | name | target | url.` }));
        continue;
      }
      const [typeCell, name, targetCell, url] = cells;
      if (/^entity[_ ]?type$/i.test(typeCell)) continue; // header row
      const type = parseType(typeCell);
      const target = targetCell.toLowerCase() as Target;
      if (!type) {
        parsed.push(newRow({ url, status: "error", message: `Unknown type “${typeCell}” (Place, Event or Business).` }));
        continue;
      }
      const okTarget = TARGETS[type].includes(target);
      const { entity, note } = await resolveEntity(type, name);
      parsed.push(
        newRow({
          entityType: type,
          entity,
          target: okTarget ? target : "cover",
          url,
          matchNote: [note, okTarget ? null : `“${targetCell}” isn't available for a ${ENTITY_LABELS[type]} — set to Cover.`].filter(Boolean).join(" ") || null,
          selected: Boolean(entity),
        })
      );
    }
    setRows((rs) => [...rs.filter((r) => r.entity || r.url), ...parsed]);
    setPaste("");
  }

  async function preview(row: Row) {
    if (!row.url.trim()) return;
    update(row.key, { status: "previewing", message: null });
    const res = await previewMediaRow(row.target, row.url).catch(() => ({ error: "Couldn't make a preview." }));
    if ("preview" in res) update(row.key, { preview: res.preview, status: "idle" });
    else update(row.key, { preview: null, status: "error", message: res.error });
  }

  async function processRows(keys: number[]) {
    setBusy(true);
    for (const key of keys) {
      // Read the latest row state; never re-run a finished or duplicate row.
      const row = rowsRef.current.find((r) => r.key === key);
      if (!row || row.status === "done" || isDuplicate(row)) continue;
      if (!row.entity) {
        update(key, { status: "error", message: "Choose an existing record first." });
        continue;
      }
      update(key, { status: "processing", message: null });
      const res = await processMediaRow({ entityType: row.entityType, entityId: row.entity.id, target: row.target, url: row.url }).catch(() => ({
        ok: false as const,
        error: "The request failed. Please try again.",
      }));
      if (res.ok) update(key, { status: "done", selected: false, message: res.previousUrl ? "Saved — replaced the previous image." : "Saved." });
      else update(key, { status: "error", message: res.error });
    }
    setBusy(false);
  }

  const pending = rows.filter((r) => r.status !== "done" && !isDuplicate(r));
  const selectedKeys = pending.filter((r) => r.selected).map((r) => r.key);

  return (
    <div className="flex flex-col gap-4">
      <details className="rounded-2xl border border-black/[0.07] bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-ink">Paste rows (type | name | target | image URL)</summary>
        <p className="mt-2 text-xs text-ink/55">
          One per line, tab- or |-separated, e.g. <code>Place | Mana Contemporary | cover | https://…/hero.jpg</code>. Each name is matched to an
          existing record for you to review before processing — nothing is created.
        </p>
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={5} className={`${inputClass} mt-2 font-mono text-xs`} />
        <button type="button" onClick={importPasted} disabled={!paste.trim() || busy} className={`${secondaryButton} mt-2`}>
          Add Pasted Rows
        </button>
      </details>

      <div className="overflow-x-auto rounded-2xl border border-black/[0.07] bg-white">
        <table className="w-full min-w-[880px] text-left text-sm">
          <thead className="border-b border-black/[0.06] text-xs uppercase tracking-wide text-ink/45">
            <tr>
              <th className="w-8 px-3 py-2" />
              <th className="w-28 px-2 py-2">Type</th>
              <th className="px-2 py-2">Record</th>
              <th className="w-24 px-2 py-2">Target</th>
              <th className="px-2 py-2">Image URL</th>
              <th className="w-28 px-2 py-2">Preview</th>
              <th className="w-48 px-2 py-2">Status</th>
              <th className="w-8 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <RowView
                key={row.key}
                row={row}
                duplicate={isDuplicate(row)}
                busy={busy}
                onChange={(patch) => update(row.key, patch)}
                onPreview={() => preview(row)}
                onRetry={() => processRows([row.key])}
                onRemove={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setRows((rs) => [...rs, newRow({ entityType: rs.at(-1)?.entityType ?? "location" })])} disabled={busy} className={secondaryButton}>
          Add Row
        </button>
        <button type="button" onClick={() => processRows(selectedKeys)} disabled={busy || selectedKeys.length === 0} className={primaryButton}>
          Process Selected ({selectedKeys.length})
        </button>
        <button type="button" onClick={() => processRows(pending.map((r) => r.key))} disabled={busy || pending.length === 0} className={secondaryButton}>
          Process All ({pending.length})
        </button>
        {busy && <span className="text-xs text-ink/55">Processing one row at a time…</span>}
      </div>
    </div>
  );
}

function RowView({
  row,
  duplicate,
  busy,
  onChange,
  onPreview,
  onRetry,
  onRemove,
}: {
  row: Row;
  duplicate: boolean;
  busy: boolean;
  onChange: (patch: Partial<Row>) => void;
  onPreview: () => void;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const locked = busy || row.status === "processing" || row.status === "done";
  return (
    <tr className="border-b border-black/[0.04] align-top last:border-0">
      <td className="px-3 py-3">
        <input type="checkbox" checked={row.selected && !duplicate && row.status !== "done"} disabled={locked || duplicate} onChange={(e) => onChange({ selected: e.target.checked })} aria-label="Select row" />
      </td>
      <td className="px-2 py-2">
        <select
          value={row.entityType}
          disabled={locked}
          onChange={(e) => {
            const entityType = e.target.value as EntityType;
            onChange({ entityType, entity: null, matchNote: null, target: TARGETS[entityType].includes(row.target) ? row.target : "cover" });
          }}
          className={inputClass}
        >
          {(Object.keys(ENTITY_LABELS) as EntityType[]).map((t) => (
            <option key={t} value={t}>
              {ENTITY_LABELS[t]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-2">
        <EntityPicker row={row} disabled={locked} onPick={(entity) => onChange({ entity, matchNote: null, status: row.status === "error" ? "idle" : row.status, message: null })} />
        {row.matchNote && <p className="mt-1 text-xs text-amber-700">{row.matchNote}</p>}
      </td>
      <td className="px-2 py-2">
        <select value={row.target} disabled={locked} onChange={(e) => onChange({ target: e.target.value as Target, preview: null })} className={inputClass}>
          {TARGETS[row.entityType].map((t) => (
            <option key={t} value={t}>
              {t === "cover" ? "Cover" : "Logo"}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-2">
        <input
          type="url"
          value={row.url}
          disabled={locked}
          onChange={(e) => onChange({ url: e.target.value, preview: null, status: row.status === "error" ? "idle" : row.status, message: null })}
          onBlur={() => row.url.trim() && !row.preview && onPreview()}
          placeholder="https://…"
          className={inputClass}
        />
      </td>
      <td className="px-2 py-2">
        {row.preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- a verified, server-made data: URI preview
          <img src={row.preview} alt="" className="h-16 w-24 rounded-lg bg-black/[0.04] object-contain" />
        ) : (
          <button type="button" onClick={onPreview} disabled={!row.url.trim() || row.status === "previewing" || locked} className="text-xs font-semibold text-ink/60 hover:text-ink disabled:opacity-40">
            {row.status === "previewing" ? "Loading…" : "Preview"}
          </button>
        )}
      </td>
      <td className="px-2 py-2 text-xs">
        {duplicate ? (
          <span className="text-amber-700">Duplicate of an earlier row — skipped.</span>
        ) : row.status === "processing" ? (
          <span className="text-ink/60">Processing…</span>
        ) : row.status === "done" ? (
          <span className="font-semibold text-emerald-700">{row.message}</span>
        ) : row.status === "error" ? (
          <span className="text-red-600">
            {row.message}{" "}
            {row.entity && row.url && (
              <button type="button" onClick={onRetry} disabled={busy} className="font-semibold underline">
                Retry
              </button>
            )}
          </span>
        ) : (
          <span className="text-ink/40">Ready</span>
        )}
      </td>
      <td className="px-2 py-2">
        <button type="button" onClick={onRemove} disabled={locked && row.status !== "done"} aria-label="Remove row" className="text-ink/35 hover:text-ink disabled:opacity-40">
          ×
        </button>
      </td>
    </tr>
  );
}

function EntityPicker({ row, disabled, onPick }: { row: Row; disabled: boolean; onPick: (e: NonNullable<Row["entity"]>) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const { results, loading } = useAdminSearch(SEARCH_ENTITY[row.entityType], query);
  if (row.entity && !open) {
    return (
      <button type="button" disabled={disabled} onClick={() => setOpen(true)} className="w-full rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2 text-left text-sm text-ink disabled:cursor-default">
        <span className="font-semibold">{row.entity.label}</span>
        {row.entity.sublabel && <span className="block truncate text-xs text-ink/50">{row.entity.sublabel}</span>}
      </button>
    );
  }
  return (
    <div className="relative">
      <input
        type="text"
        autoCapitalize="none"
        value={query}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={`Search ${ENTITY_LABELS[row.entityType]}s…`}
        className={inputClass}
      />
      {open && query.trim() && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-black/10 bg-white py-1 shadow-lg">
          {loading && results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-ink/50">Searching…</li>
          ) : results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-ink/50">No matches.</li>
          ) : (
            results.map((r) => (
              <li key={r.value}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onPick({ id: r.value, label: r.label, sublabel: r.sublabel });
                    setQuery("");
                    setOpen(false);
                  }}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-black/[0.03]"
                >
                  <span className="font-semibold text-ink">{r.label}</span>
                  {r.sublabel && <span className="block truncate text-xs text-ink/50">{r.sublabel}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
