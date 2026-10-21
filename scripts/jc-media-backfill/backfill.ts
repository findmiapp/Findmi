// One-off Jersey City media backfill (run ONLY by the manually dispatched
// .github/workflows/jc-media-backfill.yml). Fills EMPTY media fields on the
// existing Jersey City Places, Events and Businesses through Findmi's
// existing pipeline — nothing here fetches, verifies or stores on its own:
//
//   covers → resolveSourceImage (Admin Media Enrichment, aa8af79: guarded
//            safe fetch, direct image or the official page's representative
//            image, existing verification) → storeEventImage
//            (storePublicImage: findmi-media + WebP variants)
//   logos  → safeFetchBrandPage → extractBrandProfile → selectVerifiedLogo
//            (Brand Import's own logo selection: JSON-LD / header / SVG
//            marks, then manifest / touch icons; never og:image) →
//            resolveSourceImage(logo) → storeBrandImage
//
// Every write is `UPDATE … WHERE id = $1 AND <column> IS NULL`, so an
// existing image is never overwritten (a field filled since the scan is
// reported, not touched) and a re-run skips every filled field before any
// download. Provenance is the existing sidecar (writeProvenance). One
// record's failure never stops the run. No other table or entity is read
// for writing; scope is the Jersey City Area and its neighborhoods.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolveSourceImage, writeProvenance, type MediaTarget } from "@/lib/admin/media-enrichment";
import { storeEventImage } from "@/lib/event-import/media";
import { storeBrandImage } from "@/lib/brand-images";
import { safeFetchBrandPage, safeFetchManifest } from "@/lib/safe-fetch";
import { extractBrandProfile, manifestIconCandidates } from "@/lib/brand-website-extract";
import { selectVerifiedLogo, conventionalTouchIconUrl } from "@/lib/brand-candidate-builder";
import { fetchVerifiedBrandImage } from "@/lib/brand-images";

const JERSEY_CITY_AREA_ID = "b28874dc-13fc-4b21-b9bf-6160d312983d";

/** Events whose stored source is not the event's own page (approved
 * exclusions) — never media-enriched by this run. */
const EXCLUDED_EVENT_SLUGS = new Set([
  "jodeci-loews-jersey-2026",
  "mana-contemporary-three-works-by-athena-latocha",
  "jcymap-2026-celebration-art-exhibition-documentary-premiere",
  "cat-stick-easel-moon-closing-reception",
]);
/** Rocky Horror's source is the LSC After Dark series page: its image is
 * accepted only when the resolved image itself is clearly Rocky Horror's. */
const SPECIFIC_IMAGE_REQUIRED: Record<string, RegExp> = {
  "rocky-horror-picture-show-live-shadow-cast-lsc-2026": /rocky[-_ ]?horror/i,
};

type Table = "locations" | "events" | "businesses";
type Outcome = { table: Table; name: string; column: string; status: "enriched" | "skipped" | "unresolved"; detail: string };
const outcomes: Outcome[] = [];
const log = (o: Outcome) => {
  outcomes.push(o);
  console.log(`${o.status.toUpperCase().padEnd(10)} ${o.table}.${o.column}  ${o.name}  — ${o.detail}`);
};

async function scope(db: SupabaseClient) {
  const { data: areas, error: areaError } = await db.from("market_areas").select("id").or(`id.eq.${JERSEY_CITY_AREA_ID},parent_area_id.eq.${JERSEY_CITY_AREA_ID}`);
  if (areaError || !areas?.length) throw new Error("Couldn't read the Jersey City Area.");
  const areaIds = areas.map((a) => a.id as string);
  const [{ data: locations }, { data: events }] = await Promise.all([
    db.from("locations").select("id, slug, name, website_url, cover_image_url").in("market_area_id", areaIds).is("trashed_at", null),
    db.from("events").select("id, slug, name, external_url, cover_image_url").in("market_area_id", areaIds).is("trashed_at", null),
  ]);
  const locIds = (locations ?? []).map((l) => l.id as string);
  const evIds = (events ?? []).map((e) => e.id as string);
  const [{ data: own }, { data: atPlaces }, { data: onRosters }] = await Promise.all([
    db.from("businesses").select("id").in("market_area_id", areaIds),
    locIds.length ? db.from("business_locations").select("business_id").in("location_id", locIds) : Promise.resolve({ data: [] as { business_id: string }[] }),
    evIds.length ? db.from("event_businesses").select("business_id").in("event_id", evIds).eq("status", "approved") : Promise.resolve({ data: [] as { business_id: string }[] }),
  ]);
  const bizIds = [...new Set([...(own ?? []).map((b) => b.id as string), ...(atPlaces ?? []).map((b) => b.business_id as string), ...(onRosters ?? []).map((b) => b.business_id as string)])];
  const { data: businesses } = bizIds.length
    ? await db.from("businesses").select("id, slug, name, website_url, cover_image_url, logo_url").in("id", bizIds).is("trashed_at", null)
    : { data: [] };
  return { locations: locations ?? [], events: events ?? [], businesses: businesses ?? [] };
}

/** Existing Brand Import logo selection for one website; the chosen logo
 * URL or a reason. */
async function findLogo(website: string): Promise<{ url: string } | { error: string }> {
  const page = await safeFetchBrandPage(website);
  if (!page.ok) return { error: `website couldn't be read (${page.code}${page.status ? ` ${page.status}` : ""})` };
  const profile = extractBrandProfile(page.html, page.url);
  const pool = profile.logoCandidates?.length ? profile.logoCandidates : profile.logoCandidateUrl ? [profile.logoCandidateUrl] : [];
  const chosen = await selectVerifiedLogo(
    pool,
    profile.manifestUrl,
    {
      verifyImage: async (url, role) => (await fetchVerifiedBrandImage(url, role)).ok,
      fetchManifestIcons: async (manifestUrl) => {
        const fetched = await safeFetchManifest(manifestUrl);
        return fetched.ok ? manifestIconCandidates(fetched.text, fetched.url) : [];
      },
    },
    { candidates: profile.svgLogoCandidates, strongCount: profile.logoStrongCount, conventionalIcon: conventionalTouchIconUrl(page.url.href) }
  );
  return chosen ? { url: chosen } : { error: "no verifiable logo on the official website" };
}

async function fill(
  db: SupabaseClient,
  table: Table,
  entityType: "location" | "event" | "business",
  row: { id: string; slug: string; name: string },
  column: "cover_image_url" | "logo_url",
  target: MediaTarget,
  source: string,
  confirmed: { url: string; from: string } | null
) {
  try {
    const resolved = await resolveSourceImage(target, source, confirmed);
    if (!resolved.ok) return log({ table, name: row.name, column, status: "unresolved", detail: resolved.error });
    const required = SPECIFIC_IMAGE_REQUIRED[row.slug];
    if (required && !required.test(resolved.resolvedImageUrl)) {
      return log({ table, name: row.name, column, status: "unresolved", detail: `source image isn't specific to this event (${resolved.resolvedImageUrl})` });
    }
    const stored = resolved.verified.kind === "logo" ? await storeBrandImage(db, resolved.verified.image) : await storeEventImage(db, resolved.verified.image);
    if (!stored) return log({ table, name: row.name, column, status: "unresolved", detail: "verified image couldn't be stored" });
    const { data: written, error } = await db.from(table).update({ [column]: stored }).eq("id", row.id).is(column, null).select("id");
    if (error) return log({ table, name: row.name, column, status: "unresolved", detail: `record update failed (${error.code ?? "error"})` });
    if (!written?.length) return log({ table, name: row.name, column, status: "skipped", detail: "filled by someone else during the run — left as is" });
    await writeProvenance(db, stored, { sourcePageUrl: resolved.sourcePageUrl, resolvedImageUrl: resolved.resolvedImageUrl, resolvedFrom: resolved.resolvedFrom, entityType, entityId: row.id, column });
    log({ table, name: row.name, column, status: "enriched", detail: `${resolved.resolvedFrom} ${resolved.resolvedImageUrl}` });
  } catch (err) {
    log({ table, name: row.name, column, status: "unresolved", detail: `unexpected error (${err instanceof Error ? err.name : "error"})` });
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { locations, events, businesses } = await scope(db);
  console.log(`Scope: ${locations.length} Places, ${events.length} Events, ${businesses.length} Businesses (Jersey City + neighborhoods)\n`);

  for (const l of locations) {
    if (l.cover_image_url) log({ table: "locations", name: l.name, column: "cover_image_url", status: "skipped", detail: "already has media" });
    else if (!l.website_url) log({ table: "locations", name: l.name, column: "cover_image_url", status: "unresolved", detail: "no official source on record" });
    else await fill(db, "locations", "location", l, "cover_image_url", "cover", l.website_url, null);
  }
  for (const e of events) {
    if (e.cover_image_url) log({ table: "events", name: e.name, column: "cover_image_url", status: "skipped", detail: "already has media" });
    else if (EXCLUDED_EVENT_SLUGS.has(e.slug)) log({ table: "events", name: e.name, column: "cover_image_url", status: "unresolved", detail: "excluded: no event-specific official source" });
    else if (!e.external_url) log({ table: "events", name: e.name, column: "cover_image_url", status: "unresolved", detail: "no official source on record" });
    else await fill(db, "events", "event", e, "cover_image_url", "cover", e.external_url, null);
  }
  for (const b of businesses) {
    if (b.cover_image_url) log({ table: "businesses", name: b.name, column: "cover_image_url", status: "skipped", detail: "already has media" });
    else if (!b.website_url) log({ table: "businesses", name: b.name, column: "cover_image_url", status: "unresolved", detail: "no official source on record" });
    else await fill(db, "businesses", "business", b, "cover_image_url", "cover", b.website_url, null);

    if (b.logo_url) log({ table: "businesses", name: b.name, column: "logo_url", status: "skipped", detail: "already has media" });
    else if (!b.website_url) log({ table: "businesses", name: b.name, column: "logo_url", status: "unresolved", detail: "no official source on record" });
    else {
      const logo = await findLogo(b.website_url).catch(() => ({ error: "logo lookup failed" }));
      if ("error" in logo) log({ table: "businesses", name: b.name, column: "logo_url", status: "unresolved", detail: logo.error });
      else await fill(db, "businesses", "business", b, "logo_url", "logo", b.website_url, { url: logo.url, from: "page" });
    }
  }

  const count = (t: Table, c: string, s: Outcome["status"]) => outcomes.filter((o) => o.table === t && o.column === c && o.status === s).length;
  console.log("\n=== JERSEY CITY MEDIA BACKFILL ===");
  for (const [t, c, label] of [["locations", "cover_image_url", "Place covers"], ["events", "cover_image_url", "Event covers"], ["businesses", "cover_image_url", "Business covers"], ["businesses", "logo_url", "Business logos"]] as const) {
    console.log(`${label.padEnd(16)} enriched ${count(t, c, "enriched")} · already populated/skipped ${count(t, c, "skipped")} · unresolved ${count(t, c, "unresolved")}`);
  }
  console.log("\nUnresolved:");
  for (const o of outcomes.filter((x) => x.status === "unresolved")) console.log(` - ${o.table}.${o.column} ${o.name}: ${o.detail}`);
}

main().catch((err) => {
  console.error(`Backfill aborted: ${err instanceof Error ? err.message : "error"}`);
  process.exit(1);
});
