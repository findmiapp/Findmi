import Link from "next/link";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { getCensusStatus } from "@/lib/geo/census-import";
import { CENSUS_IMPORT_ORDER, CENSUS_SOURCES, DEFAULT_CENSUS_VINTAGE, normalizeSearch } from "@/lib/geo/census-format";
import { STATE_BY_USPS } from "@/lib/geo/states";
import CensusImportRunner from "./CensusImportRunner";
import BackfillRunner from "./BackfillRunner";
import { addProductGeographyAction, removeProductGeographyAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { saved?: string; error?: string; lookup?: string; state?: string; vintage?: string };

/** Geography — the canonical U.S. reference (States, Counties, Census
 * Places, ZCTAs from the official Census files) and how Findmi Markets /
 * Areas map onto it. The import runs from here, in the browser, as
 * bounded server-side slices; no terminal needed. */
export default async function GeographyAdminPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const vintage = /^\d{4}$/.test(params.vintage ?? "") ? params.vintage! : DEFAULT_CENSUS_VINTAGE;
  const admin = await requireAdminSupabase();
  const status = await getCensusStatus(vintage).catch(() => null);

  const [{ data: markets }, { data: areas }, { data: mappings, error: mapErr }] = await Promise.all([
    admin.from("markets").select("id, name, slug, active").order("sort_order"),
    admin.from("market_areas").select("id, name, slug, market_id, sort_order").order("sort_order"),
    admin.from("product_geographies").select("id, market_id, market_area_id, geo_key, role").order("geo_key"),
  ]);
  type Mapping = { id: string; market_id: string; market_area_id: string | null; geo_key: string; role: string };
  const maps = (mappings ?? []) as Mapping[];
  const marketList = (markets ?? []) as { id: string; name: string; slug: string; active: boolean }[];
  const areaList = (areas ?? []) as { id: string; name: string; slug: string; market_id: string }[];
  const geoNames = new Map<string, string>();
  if (maps.length) {
    const { data } = await admin.from("census_geographies").select("geo_key, display_name, state_usps").in("geo_key", [...new Set(maps.map((m) => m.geo_key))]);
    for (const g of (data ?? []) as { geo_key: string; display_name: string; state_usps: string | null }[]) geoNames.set(g.geo_key, g.state_usps ? `${g.display_name}, ${g.state_usps}` : g.display_name);
  }

  let lookup: { geo_key: string; kind: string; display_name: string; state_usps: string | null }[] = [];
  const lookupTerm = (params.lookup ?? "").trim().slice(0, 80);
  if (lookupTerm) {
    let q = admin.from("census_geographies").select("geo_key, kind, display_name, state_usps").is("retired_vintage", null).limit(25);
    q = /^\d{5}$/.test(lookupTerm) ? q.eq("geo_key", `zcta:${lookupTerm}`) : q.contains("search_names", [normalizeSearch(lookupTerm)]);
    const usps = (params.state ?? "").toUpperCase();
    if (STATE_BY_USPS.has(usps)) q = q.eq("state_usps", usps);
    const { data } = await q;
    lookup = (data ?? []) as typeof lookup;
  }

  const jobByDataset = new Map((status?.jobs ?? []).map((j) => [j.dataset, j]));
  const tablesMissing = Boolean(mapErr) || status?.available === false;

  return (
    <div className="max-w-3xl">
      <Link href="/admin/site" className="text-xs font-semibold text-ink/50">← Site Editor</Link>
      <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">Geography</h1>
      <p className="mt-1 text-sm text-ink/50">The official U.S. Census reference (States, Counties, Census Places, ZCTAs), and how Findmi Markets and Areas map onto it.</p>

      {params.error && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{params.error}</p>}
      {params.saved && !params.error && <p className="mt-3 rounded-xl border border-findmi-200 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">Saved.</p>}
      {tablesMissing && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">The Discovery Intelligence migration hasn&apos;t been applied to this database yet.</p>}

      <section className="mt-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink/50">Census Import</h2>
        <div className="mt-2">
          <CensusImportRunner defaultVintage={vintage} />
        </div>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-black/5 bg-white">
          <table className="w-full text-left text-xs">
            <thead className="text-ink/45">
              <tr>
                <th className="px-3 py-2 font-semibold">Dataset</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Rows</th>
                <th className="px-3 py-2 font-semibold">Source</th>
              </tr>
            </thead>
            <tbody>
              {CENSUS_IMPORT_ORDER.map((d) => {
                const j = jobByDataset.get(d);
                return (
                  <tr key={d} className="border-t border-black/5 align-top">
                    <td className="px-3 py-2 font-semibold text-ink">{CENSUS_SOURCES[d].label}</td>
                    <td className={`px-3 py-2 ${j?.status === "failed" ? "text-red-700" : j?.status === "complete" ? "text-findmi-700" : "text-ink/60"}`}>
                      {j ? j.status.replace(/^./, (c) => c.toUpperCase()) : "Not Started"}
                      {j?.error && <span className="block max-w-[14rem] break-words text-[11px]">{j.error}</span>}
                    </td>
                    <td className="px-3 py-2 text-ink/70">{j ? `${j.cursor.toLocaleString()} / ${j.rows_read.toLocaleString()}` : "—"}</td>
                    <td className="px-3 py-2 text-ink/50">
                      <span className="block">{j?.source_vintage ?? CENSUS_SOURCES[d].sourceVintage(vintage)}</span>
                      <span className="block max-w-[16rem] break-all text-[10px]">{j?.source_url ?? CENSUS_SOURCES[d].url(vintage)}</span>
                      {j?.sha256 && <span className="block text-[10px]">sha256 {j.sha256.slice(0, 12)}…</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {status?.available && (
          <p className="mt-2 text-xs text-ink/60">
            Live: {status.counts.state.toLocaleString()} States · {status.counts.county.toLocaleString()} Counties · {status.counts.place.toLocaleString()} Places · {status.counts.zcta.toLocaleString()} ZCTAs · {status.links.toLocaleString()} links
          </p>
        )}
        {status && status.unmatchedMappings.length > 0 && (
          <p className="mt-2 text-xs text-amber-800">
            Mappings waiting for the import: {status.unmatchedMappings.map((m) => `${m.area ?? m.market} → ${m.geo_key}`).join(", ")}
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink/50">Canonical Entity Geography Backfill</h2>
        <p className="mt-1 text-xs text-ink/50">
          Fills geo_place_key/geo_zcta_key/geo_state_key on existing rows that have none yet. Dry Run first — it writes
          nothing.
        </p>
        <div className="mt-2">
          <BackfillRunner />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink/50">Market / Area Mappings</h2>
        <p className="mt-1 text-xs text-ink/50">Primary = the same place. Includes = the Market contains it. Within = the Area lies inside it. Neighborhoods have no ZIP mappings unless one is added here deliberately.</p>
        <div className="mt-2 flex flex-col gap-3">
          {marketList.map((m) => {
            const rows = maps.filter((x) => x.market_id === m.id);
            return (
              <div key={m.id} className="rounded-2xl border border-black/5 bg-white p-3">
                <p className="text-sm font-semibold text-ink">{m.name}{!m.active && <span className="ml-2 text-xs text-ink/40">Inactive</span>}</p>
                {rows.length === 0 ? (
                  <p className="mt-1 text-xs text-ink/40">Not mapped.</p>
                ) : (
                  <ul className="mt-1 flex flex-col gap-1">
                    {rows.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 text-ink/70">
                          <span className="font-semibold text-ink">{r.market_area_id ? (areaList.find((a) => a.id === r.market_area_id)?.name ?? "Area") : "Market"}</span> · {r.role} · {geoNames.get(r.geo_key) ?? r.geo_key}
                        </span>
                        <form action={removeProductGeographyAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <button className="shrink-0 text-ink/40 hover:text-red-700">Remove</button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink/50">Assign Census Geography</h2>
        <form className="mt-2 flex flex-wrap gap-2" action="/admin/site/geography">
          <input name="lookup" defaultValue={lookupTerm} placeholder="Bergen County, Hoboken, 07302" autoCapitalize="none" className="min-w-0 flex-1 rounded-lg border border-black/10 px-3 py-2 text-sm" />
          <input name="state" defaultValue={params.state ?? ""} placeholder="State (NJ)" autoCapitalize="none" maxLength={2} className="w-24 rounded-lg border border-black/10 px-3 py-2 text-sm" />
          <button className="rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-ink">Look Up</button>
        </form>
        {lookupTerm && lookup.length === 0 && <p className="mt-2 text-xs text-ink/50">No Census match{status?.counts.place ? "" : " (the import hasn't run yet)"}.</p>}
        {lookup.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2">
            {lookup.map((g) => (
              <li key={g.geo_key} className="rounded-2xl border border-black/5 bg-white p-3">
                <p className="text-sm font-semibold text-ink">{g.display_name}{g.state_usps ? `, ${g.state_usps}` : ""} <span className="text-xs font-normal text-ink/40">{g.geo_key}</span></p>
                <form action={addProductGeographyAction} className="mt-2 flex flex-wrap gap-2">
                  <input type="hidden" name="geo_key" value={g.geo_key} />
                  <select name="market_id" required className="rounded-lg border border-black/10 px-2 py-1.5 text-xs">
                    {marketList.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <select name="market_area_id" className="rounded-lg border border-black/10 px-2 py-1.5 text-xs">
                    <option value="">Whole Market</option>
                    {areaList.map((a) => <option key={a.id} value={a.id}>{marketList.find((m) => m.id === a.market_id)?.name} · {a.name}</option>)}
                  </select>
                  <select name="role" className="rounded-lg border border-black/10 px-2 py-1.5 text-xs">
                    <option value="includes">Includes</option>
                    <option value="primary">Primary</option>
                    <option value="within">Within</option>
                  </select>
                  <button className="rounded-full bg-findmi px-3 py-1.5 text-xs font-bold text-white">Assign</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
