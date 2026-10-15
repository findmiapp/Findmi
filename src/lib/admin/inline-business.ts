import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findBusinessMatches } from "../business-matching";
import { cleanText } from "../brand-website-extract";
import { ensureUniqueSlug, slugify } from "../slug";

/** Admin Event Import — Missing-Business Quick Create (the Business
 * counterpart of Missing-Location Quick Create). Performs NO authorization:
 * the caller verifies the Admin session first.
 *
 * Creates the MINIMUM canonical Business, the same way Admin's Brand
 * Import creates one (createBusinessFromCandidate): a name, a unique slug,
 * an optional website, publication_status 'pending_review' (not public
 * until Admin publishes it), Free plan, not verified, not a Founding/Pro
 * member, commerce off. No owner, no membership, no claim, no Event link —
 * linking it to an Event happens only when that reviewed Event is saved.
 *
 * Duplicate-safe: the ONE Business matcher (findBusinessMatches — every
 * real row, live or not) runs first unless the Admin explicitly forces it,
 * and a likely match is offered instead of creating. */
export type InlineBusiness = { id: string; name: string };
export type InlineBusinessResult =
  | { status: "created"; business: InlineBusiness }
  | { status: "duplicates"; duplicates: (InlineBusiness & { isPublic: boolean })[] }
  | { status: "error"; error: string };

export async function insertInlineBusiness(
  admin: SupabaseClient,
  input: { name: unknown; websiteUrl?: unknown; force?: boolean }
): Promise<InlineBusinessResult> {
  const name = cleanText(typeof input.name === "string" ? input.name : null, 160);
  if (!name) return { status: "error", error: "Add the Business name." };
  let website: string | null = null;
  const rawSite = typeof input.websiteUrl === "string" ? input.websiteUrl.trim() : "";
  if (rawSite) {
    try {
      const u = new URL(/^https?:\/\//i.test(rawSite) ? rawSite : `https://${rawSite}`);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("scheme");
      website = u.toString();
    } catch {
      return { status: "error", error: "Website isn't a valid link." };
    }
  }

  if (!input.force) {
    const matches = await findBusinessMatches(admin, { name, websiteUrl: website });
    if (matches.length > 0) return { status: "duplicates", duplicates: matches.map((m) => ({ id: m.id, name: m.name, isPublic: m.isPublic })) };
  }

  const base = slugify(name) || "business";
  const isSlugTaken = async (slug: string) => {
    const { data } = await admin.from("businesses").select("id").eq("slug", slug).limit(1);
    return (data ?? []).length > 0;
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = await ensureUniqueSlug(attempt === 0 ? base : `${base}-${attempt + 1}`, isSlugTaken);
    const { data, error } = await admin
      .from("businesses")
      .insert({
        name,
        slug,
        website_url: website,
        plan_tier: "free",
        publication_status: "pending_review",
        is_demo: false,
        verified: false,
        founding_member: false,
        commerce_enabled: false,
      })
      .select("id, name")
      .single();
    if (!error && data) return { status: "created", business: data as InlineBusiness };
    // A concurrent slug collision → try the next slug; anything else fails.
    if ((error as { code?: string } | null)?.code !== "23505") break;
  }
  return { status: "error", error: "Couldn't add this Business. Please try again." };
}
