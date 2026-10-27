import SupabaseImage from "@/components/SupabaseImage";
import { formatCardWhen } from "@/lib/event-time";
import { formatCardDateRange } from "@/lib/format";
import type { EntityResultsConfig } from "@/lib/page-sections";
import type { EntityResults, ResolvedEntity } from "@/lib/page-sections-server";
import type { RefItem } from "./RefListField";

const KIND: Record<string, string> = { event: "Event", appearance: "Pop-Up", business: "Brand", place: "Place", product: "Product" };
const ORIGIN: Record<ResolvedEntity["origin"], string> = { pinned: "Pinned", included: "Picked", auto: "Matched" };
const small = "inline-flex min-h-9 items-center rounded-full border border-black/10 bg-white px-3 text-[11px] font-semibold text-ink/70 transition hover:border-black/25";

/** Pages + Sections V1B — what an Entity Results Section returns right now,
 * read through the same public resolver the Guide uses (so drafts preview
 * honestly). Shows the count, which entities render (and why: pinned,
 * picked or matched), further matches beyond the Section's limit, and the
 * exclusions — each with one-tap Pin / Exclude / Restore. Bounded to the
 * resolver's cap. */
export default function PreviewResults({
  config,
  results,
  excludedLabels,
  refAction,
}: {
  config: EntityResultsConfig;
  results: EntityResults;
  excludedLabels: RefItem[];
  refAction: (formData: FormData) => void;
}) {
  const shown = results.items.slice(0, config.limit);
  const more = config.mode === "manual" ? [] : results.items.slice(config.limit).filter((i) => i.origin === "auto");
  const count = results.matched == null ? null : results.capped ? `${results.matched}+` : String(results.matched);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-semibold text-ink">
        {shown.length} {shown.length === 1 ? "item" : "items"} on the Page
        {count !== null && <span className="font-normal text-ink/55"> · {count} {results.matched === 1 ? "match" : "matches"}</span>}
        {results.excludedMatches > 0 && <span className="font-normal text-ink/55"> · {results.excludedMatches} excluded</span>}
      </p>
      {results.missing.length > 0 && (
        <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
          {results.missing.length} picked or pinned {results.missing.length === 1 ? "item is" : "items are"} no longer public and won&rsquo;t show.
        </p>
      )}
      {shown.length === 0 ? (
        <p className="text-sm text-ink/50">Nothing matches right now. This Section is hidden on the Page until something does.</p>
      ) : (
        <ResultList items={shown} config={config} refAction={refAction} />
      )}
      {more.length > 0 && (
        <details>
          <summary className="cursor-pointer select-none text-xs font-semibold text-ink/60">More Matches Not Shown ({more.length})</summary>
          <div className="mt-2">
            <ResultList items={more} config={config} refAction={refAction} />
          </div>
        </details>
      )}
      {config.mode !== "manual" && excludedLabels.length > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Excluded</p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {excludedLabels.map((x) => (
              <li key={x.value} className="flex items-center justify-between gap-2 rounded-xl border border-black/[0.06] bg-black/[0.015] px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink/70">{x.label}</span>
                  {x.sublabel && <span className="block truncate text-xs text-ink/40">{x.sublabel}</span>}
                </span>
                <RefButton refAction={refAction} value={x.value} action="restore" label="Restore" />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RefButton({ refAction, value, action, label }: { refAction: (formData: FormData) => void; value: string; action: string; label: string }) {
  return (
    <form action={refAction}>
      <input type="hidden" name="ref" value={value} />
      <input type="hidden" name="ref_action" value={action} />
      <button type="submit" className={small}>
        {label}
      </button>
    </form>
  );
}

function ResultList({ items, config, refAction }: { items: ResolvedEntity[]; config: EntityResultsConfig; refAction: (formData: FormData) => void }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((r) => {
        const e = r.entity;
        const view =
          e.type === "product"
            ? { kind: "product", title: e.product.name, sub: e.product.business?.name ?? null, image: e.product.image_url ?? null, when: null }
            : { kind: e.item.kind, title: e.item.title, sub: e.item.subtitle, image: e.item.image, when: e.item.start_at || e.item.start_date ? formatCardWhen(e.item, formatCardDateRange) : null };
        return (
          <li key={r.key} className="flex flex-col gap-2 rounded-xl border border-black/10 bg-white p-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-black/5">
                {view.image && <SupabaseImage src={view.image} alt="" fill sizes="44px" className="object-cover" />}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{view.title}</p>
                <p className="truncate text-xs text-ink/50">{[KIND[view.kind] ?? view.kind, view.when, view.sub].filter(Boolean).join(" · ")}</p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${r.origin === "auto" ? "bg-black/[0.05] text-ink/50" : "bg-findmi-50 text-findmi-700"}`}>{ORIGIN[r.origin]}</span>
              {config.mode !== "manual" && (r.origin === "pinned" ? <RefButton refAction={refAction} value={r.key} action="unpin" label="Unpin" /> : <RefButton refAction={refAction} value={r.key} action="pin" label="Pin" />)}
              {r.origin === "included" && <RefButton refAction={refAction} value={r.key} action="remove" label="Remove" />}
              {config.mode !== "manual" && r.origin !== "included" && <RefButton refAction={refAction} value={r.key} action="exclude" label="Exclude" />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
