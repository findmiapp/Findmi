"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { errorRedirectUrl, localDateTimeToIso, str } from "@/lib/admin/form-helpers";
import { TIME_UNKNOWN_MARKER } from "@/lib/format";
import {
  extractAppearancesFromSource,
  isAnthropicConfigured,
  MAX_IMPORT_IMAGES,
  validateImportImage,
  type AppearanceDraft,
  type ImportImage,
} from "@/lib/admin/appearance-import";
import { findDuplicateMatches, findEventMatches, type DuplicateCandidate, type EventMatchCandidate } from "@/lib/admin/appearance-matching";

// ---------------------------------------------------------------------
// Step 1 -> analyze. Never writes to the database — the result is plain
// JSON handed back to the client component's own state (ImportForm.tsx),
// which is where the admin reviews/edits before anything is created.
// ---------------------------------------------------------------------

export interface DraftRow {
  draft: AppearanceDraft;
  eventMatch: EventMatchCandidate | null;
  duplicateMatch: DuplicateCandidate | null;
}

export interface AnalyzeResult {
  rows: DraftRow[];
  error?: string;
}

export async function analyzeAppearances(formData: FormData): Promise<AnalyzeResult> {
  if (!isAnthropicConfigured()) {
    return {
      rows: [],
      error: "Anthropic isn't configured on the server (ANTHROPIC_API_KEY is unset) — ask the founder to set it, then try again.",
    };
  }

  const businessId = str(formData, "business_id");
  if (!businessId) {
    return { rows: [], error: "Choose a business first." };
  }

  // Hardening pass, item 3 — everything below can throw for reasons that
  // have nothing to do with Claude (a DB hiccup, a malformed upload, etc).
  // Wrapped so the admin always gets back a plain, readable error and
  // stays on the import screen with their source material intact, never
  // an uncaught exception / raw error dump in the browser.
  try {
    const supabase = getAdminSupabase();
    const { data: business } = supabase
      ? await supabase.from("businesses").select("name, city, state").eq("id", businessId).maybeSingle()
      : { data: null };
    if (!business) {
      return { rows: [], error: "Couldn't find the selected business — try choosing it again." };
    }

    const files = formData.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length > MAX_IMPORT_IMAGES) {
      return { rows: [], error: `Please upload at most ${MAX_IMPORT_IMAGES} images at a time.` };
    }

    const images: ImportImage[] = [];
    for (const file of files) {
      const validationError = validateImportImage(file);
      if (validationError) return { rows: [], error: validationError };
      const bytes = Buffer.from(await file.arrayBuffer());
      images.push({ mediaType: file.type as ImportImage["mediaType"], base64: bytes.toString("base64") });
    }

    const { drafts, error } = await extractAppearancesFromSource({
      businessName: business.name,
      businessCity: business.city,
      businessState: business.state,
      text: str(formData, "text"),
      images,
    });
    if (error) return { rows: [], error };
    if (drafts.length === 0) {
      return { rows: [], error: "Nothing was detected in that source — try adding more detail, or a clearer image." };
    }

    // Event matching + duplicate detection (items required for V1) — both
    // deterministic, both read-only, both scoped to real existing rows only.
    const [eventMatches, duplicateMatches] = await Promise.all([
      findEventMatches(drafts),
      findDuplicateMatches(businessId, drafts),
    ]);

    return {
      rows: drafts.map((draft, i) => ({
        draft,
        eventMatch: eventMatches[i] ?? null,
        duplicateMatch: duplicateMatches[i] ?? null,
      })),
    };
  } catch {
    return { rows: [], error: "Something went wrong analyzing that source material. Please try again." };
  }
}

// ---------------------------------------------------------------------
// Step 2 -> bulk create. Same payload shape/columns saveAppearance
// (appearances/actions.ts) already writes — this is not a second
// persistence path with different rules, just a batched insert of the
// same shape with fields this UI doesn't expose defaulted exactly like a
// normal single Appearance create would leave them.
// ---------------------------------------------------------------------

export interface CreateRowInput {
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM (24h), or null when the row's time is TBD. */
  start_time: string | null;
  end_time: string | null;
  venue_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  status: "confirmed" | "tentative" | "canceled";
  event_id: string | null;
}

const VALID_STATUSES = new Set(["confirmed", "tentative", "canceled"]);
const IMPORT_PATH = "/admin/appearances/import";
// Hardening pass, item 4 — a generous but real ceiling. Nothing this UI
// asks Claude for should ever legitimately be longer than this; it exists
// only as a backstop against a malformed/adversarial response, not a
// constraint anyone should normally hit.
const MAX_TITLE_LEN = 200;
const MAX_FIELD_LEN = 200;

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max).trim() : value;
}

function normalizeForDupeCheck(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export async function createAppearancesBulk(businessId: string, rows: CreateRowInput[]) {
  const supabase = getAdminSupabase();
  const businessPath = businessId ? `${IMPORT_PATH}?business=${businessId}` : IMPORT_PATH;
  if (!supabase) redirect(errorRedirectUrl(businessPath, "Server isn't configured for writes."));
  if (!businessId) redirect(errorRedirectUrl(IMPORT_PATH, "Choose a business first."));
  if (rows.length === 0) redirect(errorRedirectUrl(businessPath, "Select at least one appearance to create."));

  // Hardening pass, item 4 — every field below is client-supplied and
  // editable on the review screen; none of it is trusted as-is. Re-checked
  // here regardless of what the review UI displayed.
  const { data: business } = await supabase.from("businesses").select("id").eq("id", businessId).maybeSingle();
  if (!business) redirect(errorRedirectUrl(IMPORT_PATH, "The selected business no longer exists."));

  // Item 6 — an event suggestion from analysis is only ever a suggestion.
  // Re-validated here regardless of whether the admin accepted, changed,
  // or cleared it; a stale/deleted event id (or a fabricated one, since
  // this arrives as a plain function argument, not a trusted form field)
  // silently becomes "no event" rather than erroring or ever creating an
  // Event — this importer never creates Events, only optionally links to
  // one that genuinely still exists.
  const eventIds = Array.from(new Set(rows.map((r) => r.event_id).filter((v): v is string => Boolean(v))));
  let validEventIds = new Set<string>();
  if (eventIds.length > 0) {
    const { data: events } = await supabase.from("events").select("id").in("id", eventIds);
    validEventIds = new Set((events ?? []).map((e) => e.id));
  }

  // Item 1 — a row with no real start_time (time TBD) still needs a real
  // timestamp to satisfy the NOT NULL start_at column; noon on the
  // correct date is the least presumptuous placeholder. TIME_UNKNOWN_MARKER
  // is written into description so every render path (formatAppearanceTime/
  // formatAppearanceDateRange, lib/format.ts) shows "Time TBD" instead of
  // ever displaying that placeholder as if it were real — see that file's
  // own note on why this doesn't need a schema column.
  const payloads = rows
    .filter((row) => Boolean(row.title?.trim()) && /^\d{4}-\d{2}-\d{2}$/.test(row.date))
    .map((row) => {
      const timeUnknown = !row.start_time;
      const start_at = localDateTimeToIso(`${row.date}T${row.start_time ?? "12:00"}`);
      if (!start_at || Number.isNaN(new Date(start_at).getTime())) return null;
      const end_at = row.end_time ? localDateTimeToIso(`${row.date}T${row.end_time}`) : null;
      // "End is not earlier than start when both represent real times" —
      // a TBD row's end_at is always null (never a real time to compare),
      // so this only ever rejects a genuine end-before-start mistake.
      if (end_at && new Date(end_at).getTime() < new Date(start_at).getTime()) return null;
      return {
        business_id: businessId,
        event_id: row.event_id && validEventIds.has(row.event_id) ? row.event_id : null,
        title: clip(row.title.trim(), MAX_TITLE_LEN),
        description: timeUnknown ? TIME_UNKNOWN_MARKER : null,
        start_at,
        end_at,
        venue_name: row.venue_name?.trim() ? clip(row.venue_name.trim(), MAX_FIELD_LEN) : null,
        address: row.address?.trim() ? clip(row.address.trim(), MAX_FIELD_LEN) : null,
        city: row.city?.trim() ? clip(row.city.trim(), MAX_FIELD_LEN) : null,
        state: row.state?.trim() ? clip(row.state.trim(), MAX_FIELD_LEN) : null,
        status: VALID_STATUSES.has(row.status) ? row.status : "confirmed",
        is_featured: false,
        bulletin_text: null,
        show_on_home: false,
        home_sort_order: null,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  if (payloads.length === 0) {
    redirect(errorRedirectUrl(businessPath, "None of the selected rows had valid required fields (title, date, and a start time no earlier than the end time)."));
  }

  // Item 5 — a lightweight final safeguard, not a re-run of the fuzzy
  // "Possible Duplicate" suggestion (that one stays the admin's call, per
  // "do not automatically block intentional Create Anyway"). Deliberately
  // narrow: same business + same title + the exact same start_at down to
  // the minute. Two genuinely distinct same-day appearances will almost
  // never share an identical time too, so this is really only catching
  // byte-identical resubmission (e.g. two rapid clicks on Create
  // Selected) — not a legitimate "create it anyway" decision — so
  // silently skipping just those exact-match rows is safe, not a block.
  const { data: currentAppearances } = await supabase
    .from("appearances")
    .select("title, start_at")
    .eq("business_id", businessId)
    .neq("status", "canceled");
  // Compared as parsed instants, not raw strings — PostgREST doesn't
  // guarantee it echoes timestamptz back in the exact same string format
  // localDateTimeToIso() produced, and a format mismatch (+00:00 vs Z,
  // missing milliseconds) must never cause a false negative here.
  const dupeKey = (title: string, startAtIso: string) => `${normalizeForDupeCheck(title)}|${new Date(startAtIso).getTime()}`;
  const existingKeys = new Set((currentAppearances ?? []).map((a) => dupeKey(a.title, a.start_at)));
  const finalPayloads = payloads.filter((p) => !existingKeys.has(dupeKey(p.title, p.start_at)));

  if (finalPayloads.length === 0) {
    redirect(errorRedirectUrl(businessPath, "Every selected row already exists for this business (likely a duplicate submission) — nothing new was created."));
  }

  const { error } = await supabase.from("appearances").insert(finalPayloads);
  if (error) redirect(errorRedirectUrl(businessPath, error.message));

  revalidatePath("/admin/appearances");
  revalidatePath("/");
  revalidatePath("/find");
  revalidatePath("/discover");
  redirect(`/admin/appearances?business=${businessId}&imported=${finalPayloads.length}`);
}
