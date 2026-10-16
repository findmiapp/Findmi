import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { str } from "@/lib/admin/form-helpers";
import { isSlugTaken } from "@/lib/admin/queries";
import { ensureUniqueSlug, resolveSlugInput } from "@/lib/slug";
import { findLikelyDuplicateLocations, type CreateInlineLocationResult } from "@/lib/locationCreation";

/** Inline place creation — the ONE set of rules behind Missing-Location
 * Quick Create: name + street address + city + state (ZIP optional), the
 * shared duplicate check (skipped only on an explicit "force"), an unlisted
 * Location (is_demo = true), and no membership for anyone. Performs NO
 * authorization: each caller authorizes first with its own mechanism (the
 * member-facing createInlinePlace, or the Admin Event Import's admin
 * session) and passes the service-role client it holds. */
export async function insertInlinePlace(admin: SupabaseClient, formData: FormData): Promise<CreateInlineLocationResult> {
  return insertUnlistedPlace(admin, {
    name: str(formData, "name"),
    address: str(formData, "address"),
    city: str(formData, "city"),
    state: str(formData, "state"),
    postalCode: str(formData, "postal_code"),
    force: str(formData, "force") === "1",
  });
}

/** Profile values Location Import V1 may add to the SAME unlisted insert —
 * existing `locations` columns only, each already validated by the caller.
 * Never is_demo, ownership, membership or a Business relationship. */
export interface UnlistedPlaceProfile {
  website_url?: string | null;
  phone?: string | null;
  description?: string | null;
  category_id?: string | null;
  hours?: unknown;
  latitude?: number | null;
  longitude?: number | null;
}

/** The one Missing-Location insert rule set (see insertInlinePlace). */
export async function insertUnlistedPlace(
  admin: SupabaseClient,
  input: { name: string | null; address: string | null; city: string | null; state: string | null; postalCode: string | null; force?: boolean; profile?: UnlistedPlaceProfile }
): Promise<CreateInlineLocationResult> {
  const { name, address, city, state, postalCode } = input;
  const force = input.force === true;

  if (!name) return { status: "error", error: "Place name is required." };
  // Minimum physical identity for V1: a street address with its city and
  // state (ZIP optional) — enough to tell one place from another.
  if (!address || !city || !state) {
    return { status: "error", error: "Add the street address, city and state so this place can be identified." };
  }

  if (!force) {
    const duplicates = await findLikelyDuplicateLocations(admin, { name, address, city, state, postal_code: postalCode });
    if (duplicates.length > 0) return { status: "duplicates", duplicates };
  }

  const baseSlug = resolveSlugInput(null, name);
  if (!baseSlug) return { status: "error", error: "Place name is required to generate a URL." };
  const slug = await ensureUniqueSlug(baseSlug, (candidate) => isSlugTaken("locations", candidate));

  const profile = Object.fromEntries(Object.entries(input.profile ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== ""));
  const { data: created, error } = await admin
    .from("locations")
    .insert({ ...profile, name, slug, address, city, state, postal_code: postalCode, is_demo: true })
    .select("id, slug, name, address, city, state, postal_code")
    .single();
  if (error || !created) {
    console.error("createInlinePlace failed:", error?.message);
    return { status: "error", error: "Couldn't add this place. Please try again." };
  }

  const row = created as { id: string; slug: string; name: string; address: string | null; city: string | null; state: string | null; postal_code: string | null };
  return {
    status: "created",
    location: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      category: null,
      address: row.address,
      city: row.city,
      state: row.state,
      postal_code: row.postal_code,
      is_public: false,
    },
  };
}
