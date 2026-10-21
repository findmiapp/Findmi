import { getAdminSupabase } from "./admin/supabase-admin";
import { hasMomentAuthorship } from "./moment-authorship";
import { resolveSignedUrls } from "./journal";

/** Moments posted AS a Business (journal_entries.author_business_id) — what
 * the Business Manager's Moments view and Home strip show. Same tables and
 * signed-cover helper My Moments uses; the only difference is the scope
 * (this Business's authorship, not the viewer's). The caller must already
 * have authorized the viewer for this Business (requireBusinessMember on the
 * page); this does no authorization of its own — same convention as every
 * other lib/business-*.ts read helper. Returns [] before the authorship
 * column exists. */
export interface BusinessMoment {
  id: string;
  title: string;
  entryDate: string;
  status: "draft" | "published" | string;
  visibility: string;
  coverUrl: string | null;
  photoCount: number;
  locationName: string | null;
}

export async function getBusinessMoments(businessId: string, options?: { limit?: number }): Promise<BusinessMoment[]> {
  const admin = getAdminSupabase();
  if (!admin || !(await hasMomentAuthorship())) return [];
  let query = admin
    .from("journal_entries")
    .select("id, title, entry_date, status, visibility, manual_location_name, manual_location_city, location:locations(name)")
    .eq("author_business_id", businessId)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (options?.limit) query = query.limit(options.limit);
  const { data } = await query;
  type Row = {
    id: string;
    title: string;
    entry_date: string;
    status: string;
    visibility: string;
    manual_location_name: string | null;
    manual_location_city: string | null;
    location: { name: string } | { name: string }[] | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  if (rows.length === 0) return [];

  const { data: mediaRows } = await admin
    .from("journal_entry_media")
    .select("journal_entry_id, storage_path, is_cover, display_order")
    .in("journal_entry_id", rows.map((r) => r.id));
  const byEntry = new Map<string, { storage_path: string; is_cover: boolean; display_order: number }[]>();
  for (const m of mediaRows ?? []) {
    const list = byEntry.get(m.journal_entry_id) ?? [];
    list.push(m);
    byEntry.set(m.journal_entry_id, list);
  }
  const coverOf = (id: string) => {
    const list = byEntry.get(id) ?? [];
    return list.find((m) => m.is_cover) ?? [...list].sort((a, b) => a.display_order - b.display_order)[0];
  };
  const signed = await resolveSignedUrls(
    rows.flatMap((r) => {
      const c = coverOf(r.id);
      return c ? [c.storage_path] : [];
    }),
    "card"
  );
  return rows.map((r) => {
    const cover = coverOf(r.id);
    const loc = Array.isArray(r.location) ? (r.location[0] ?? null) : r.location;
    return {
      id: r.id,
      title: r.title,
      entryDate: r.entry_date,
      status: r.status,
      visibility: r.visibility,
      coverUrl: cover ? (signed.get(cover.storage_path) ?? null) : null,
      photoCount: byEntry.get(r.id)?.length ?? 0,
      locationName: loc?.name ?? r.manual_location_name ?? r.manual_location_city ?? null,
    };
  });
}

/** Where a Moment opens: published → its public/detail page, a draft → the
 * editor. Both routes already exist. */
export function momentHref(m: Pick<BusinessMoment, "id" | "status">): string {
  return m.status === "published" ? `/journal/${m.id}` : `/my-world/journal/${m.id}/edit`;
}

export function newMomentHref(businessId: string): string {
  const id = encodeURIComponent(businessId);
  return `/my-world/journal/new?business=${id}&postAs=${id}`;
}
