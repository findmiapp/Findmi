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
  const name = str(formData, "name");
  const address = str(formData, "address");
  const city = str(formData, "city");
  const state = str(formData, "state");
  const postalCode = str(formData, "postal_code");
  const force = str(formData, "force") === "1";

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

  const { data: created, error } = await admin
    .from("locations")
    .insert({ name, slug, address, city, state, postal_code: postalCode, is_demo: true })
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
