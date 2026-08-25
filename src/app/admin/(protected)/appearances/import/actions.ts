"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { errorRedirectUrl, localDateTimeToIso, str } from "@/lib/admin/form-helpers";
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

export async function createAppearancesBulk(businessId: string, rows: CreateRowInput[]) {
  const supabase = getAdminSupabase();
  const businessPath = businessId ? `${IMPORT_PATH}?business=${businessId}` : IMPORT_PATH;
  if (!supabase) redirect(errorRedirectUrl(businessPath, "Server isn't configured for writes."));
  if (!businessId) redirect(errorRedirectUrl(IMPORT_PATH, "Choose a business first."));
  if (rows.length === 0) redirect(errorRedirectUrl(businessPath, "Select at least one appearance to create."));

  const { data: business } = await supabase.from("businesses").select("id").eq("id", businessId).maybeSingle();
  if (!business) redirect(errorRedirectUrl(IMPORT_PATH, "The selected business no longer exists."));

  const eventIds = Array.from(new Set(rows.map((r) => r.event_id).filter((v): v is string => Boolean(v))));
  let validEventIds = new Set<string>();
  if (eventIds.length > 0) {
    const { data: events } = await supabase.from("events").select("id").in("id", eventIds);
    validEventIds = new Set((events ?? []).map((e) => e.id));
  }

  const payloads = rows
    .filter((row) => Boolean(row.title?.trim()) && /^\d{4}-\d{2}-\d{2}$/.test(row.date))
    .map((row) => {
      const start_at = localDateTimeToIso(`${row.date}T${row.start_time ?? "12:00"}`);
      if (!start_at) return null;
      const end_at = row.end_time ? localDateTimeToIso(`${row.date}T${row.end_time}`) : null;
      return {
        business_id: businessId,
        event_id: row.event_id && validEventIds.has(row.event_id) ? row.event_id : null,
        title: row.title.trim(),
        description: null,
        start_at,
        end_at,
        venue_name: row.venue_name?.trim() || null,
        address: row.address?.trim() || null,
        city: row.city?.trim() || null,
        state: row.state?.trim() || null,
        status: VALID_STATUSES.has(row.status) ? row.status : "confirmed",
        is_featured: false,
        bulletin_text: null,
        show_on_home: false,
        home_sort_order: null,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  if (payloads.length === 0) {
    redirect(errorRedirectUrl(businessPath, "None of the selected rows had a valid title and date."));
  }

  const { error } = await supabase.from("appearances").insert(payloads);
  if (error) redirect(errorRedirectUrl(businessPath, error.message));

  revalidatePath("/admin/appearances");
  revalidatePath("/");
  revalidatePath("/find");
  revalidatePath("/discover");
  redirect(`/admin/appearances?business=${businessId}&imported=${payloads.length}`);
}
