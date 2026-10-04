// Journal author attribution — Recovery pass.
//
// A Journal byline names the entry's real author: the owner's profile
// display name. The old author_label column was stamped "Findmi" whenever
// the shared admin cookie happened to be set at capture time, which
// mislabeled personal entries; it's now only a fallback for an author with
// no display name. Server-only (profiles has no anon read — service-role
// client); only the display name ever leaves this module, never an email
// or user id.
import { getAdminSupabase } from "./admin/supabase-admin";
import { getSupabase } from "./supabase";

/** A display name that looks like an email address is never shown. */
function safeName(name: string | null | undefined): string | null {
  const n = name?.trim();
  return n && !n.includes("@") ? n : null;
}

export async function resolveJournalAuthorNames(userIds: (string | null | undefined)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  const map = new Map<string, string>();
  const admin = getAdminSupabase();
  if (!admin || ids.length === 0) return map;
  const { data } = await admin.from("profiles").select("id, display_name").in("id", ids);
  for (const row of (data ?? []) as { id: string; display_name: string | null }[]) {
    const name = safeName(row.display_name);
    if (name) map.set(row.id, name);
  }
  return map;
}

/** Profile name first; the stored label only when there's no name. */
export function journalByline(authorName: string | null | undefined, authorLabel: string | null | undefined): string | null {
  return safeName(authorName) ?? (authorLabel?.trim() || null);
}

/** The author behind one PUBLIC, published entry — the key for that
 * author's public Journal (/journal?author=<entryId>). Read through the
 * anon client, so a private/draft entry resolves to null. The user id is
 * returned for server-side querying only and must never be rendered. */
export async function resolvePublicJournalAuthor(entryId: string): Promise<{ userId: string; name: string | null } | null> {
  const supabase = getSupabase();
  if (!supabase || !/^[0-9a-f-]{36}$/i.test(entryId)) return null;
  const { data } = await supabase
    .from("journal_entries")
    .select("user_id, author_label")
    .eq("id", entryId)
    .eq("visibility", "public")
    .eq("status", "published")
    .maybeSingle<{ user_id: string; author_label: string | null }>();
  if (!data?.user_id) return null;
  const names = await resolveJournalAuthorNames([data.user_id]);
  return { userId: data.user_id, name: journalByline(names.get(data.user_id), data.author_label) };
}

export function journalAuthorHref(entryId: string): string {
  return `/journal?author=${encodeURIComponent(entryId)}`;
}
