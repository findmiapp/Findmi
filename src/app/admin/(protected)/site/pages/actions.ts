"use server";

// Discovery Page Builder Phase 1 — Server Actions for the generalized
// admin surface: Discovery Page identity/publication CRUD, and Section
// (homepage_rows row) CRUD + the full deterministic move set (Up/Down/
// Top/Bottom/Before/After/Direct Position/Move Under Group/Return to Top
// Level). Every write goes through requireAdminSupabase() — same
// boundary every other admin Server Action on Findmi already uses.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { bool, errorRedirectUrl, num, str } from "@/lib/admin/form-helpers";
import { ensureUniqueSlug, resolveSlugInput } from "@/lib/slug";
import { recordAdminAudit } from "@/lib/admin/audit";
import { guidePath, nextPublishedAt, validateGuideDetails } from "@/lib/guides";
import type { HomepageRowContentType, HomepageRowMode, HomepageRowSectionType, HomepageRowTimeWindow } from "@/lib/homepage-rows";

const LIST_PATH = "/admin/site/pages";
function pagePath(pageId: string) {
  return `${LIST_PATH}/${pageId}`;
}

const CONTENT_TYPES: HomepageRowContentType[] = ["businesses", "events", "products", "business_showcase"];
const MODES: HomepageRowMode[] = ["dynamic", "curated", "hybrid"];
const TIME_WINDOWS: HomepageRowTimeWindow[] = ["now", "weekend", "anytime"];

// Pages + Sections V1A — every Page / Section change is recorded in
// admin_audit_events (shared admin actor; no individual identity). Logging
// is best-effort and never blocks the change itself.
async function auditPage(supabase: SupabaseClient, action: string, pageId: string, detail: Record<string, unknown> = {}) {
  await recordAdminAudit(supabase, { action, actor: { kind: "admin" }, targetType: "discovery_page", targetId: pageId, detail });
}
async function auditSection(supabase: SupabaseClient, action: string, sectionId: string, pageId: string, detail: Record<string, unknown> = {}) {
  await recordAdminAudit(supabase, { action, actor: { kind: "admin" }, targetType: "page_section", targetId: sectionId, detail: { page_id: pageId, ...detail } });
}

/** Revalidates a Page's editor and its public surfaces. */
async function revalidatePage(pageId: string, slug?: string | null) {
  revalidatePath(pagePath(pageId));
  revalidatePath(LIST_PATH);
  revalidatePath("/");
  if (slug) revalidatePath(guidePath(slug));
  revalidatePath("/sitemap.xml");
}

async function pageSlug(supabase: SupabaseClient, pageId: string): Promise<string | null> {
  const { data } = await supabase.from("discovery_pages").select("slug").eq("id", pageId).maybeSingle();
  return (data as { slug: string } | null)?.slug ?? null;
}

// ── Discovery Pages ─────────────────────────────────────────────────────

export async function createDiscoveryPage(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const internalName = str(formData, "internal_name") ?? "New Page";
  const title = str(formData, "title") ?? internalName;
  const base = resolveSlugInput(str(formData, "slug"), title) || "page";
  const slug = await ensureUniqueSlug(base, async (candidate) => {
    const { data } = await supabase.from("discovery_pages").select("id").eq("slug", candidate).maybeSingle();
    return Boolean(data);
  });

  // Phase 1: every newly created page starts unpublished — it has no
  // public route yet (Phase 3), and this keeps "create a test page" safe
  // by construction rather than by founder discipline.
  const { data, error } = await supabase
    .from("discovery_pages")
    .insert({
      internal_name: internalName,
      title,
      slug,
      description: str(formData, "description"),
      is_published: false,
      category_slug: str(formData, "category_slug"),
      market_slug: str(formData, "market_slug"),
      area_slug: str(formData, "area_slug"),
    })
    .select("id")
    .single();
  if (error || !data) redirect(errorRedirectUrl(LIST_PATH, error?.message ?? "Could not create page."));

  await auditPage(supabase, "page_create", data.id, { slug });
  revalidatePath(LIST_PATH);
  redirect(`${pagePath(data.id)}?saved=page_created`);
}

/** Saves a Page's details. Publication is NOT part of this form — it
 * changes only through the explicit Publish / Unpublish actions below, so
 * saving never publishes or unpublishes anything. The reserved Homepage
 * system page's slug/publication are never accepted here (the editor shows
 * them read-only; the DB triggers are the hard backstop), and it has no
 * Guide fields. */
export async function saveDiscoveryPage(id: string, isSystem: boolean, formData: FormData) {
  const supabase = await requireAdminSupabase();

  const payload: Record<string, unknown> = {
    internal_name: str(formData, "internal_name") ?? "Untitled Page",
    title: str(formData, "title") ?? "Untitled Page",
    description: str(formData, "description"),
    category_slug: str(formData, "category_slug"),
    market_slug: str(formData, "market_slug"),
    area_slug: str(formData, "area_slug"),
    updated_at: new Date().toISOString(),
  };
  if (!isSystem) {
    const details = validateGuideDetails({
      hero_image_url: str(formData, "hero_image_url"),
      hero_image_alt: str(formData, "hero_image_alt"),
      cta_label: str(formData, "cta_label"),
      cta_url: str(formData, "cta_url"),
      seo_title: str(formData, "seo_title"),
      seo_description: str(formData, "seo_description"),
      og_image_url: str(formData, "og_image_url"),
      starts_on: str(formData, "starts_on"),
      ends_on: str(formData, "ends_on"),
    });
    if (!details.ok) redirect(errorRedirectUrl(pagePath(id), details.error));
    Object.assign(payload, details.value);
    const slugRaw = str(formData, "slug");
    if (slugRaw) {
      const base = resolveSlugInput(slugRaw, payload.title as string) || "page";
      payload.slug = await ensureUniqueSlug(base, async (candidate) => {
        const { data } = await supabase.from("discovery_pages").select("id").eq("slug", candidate).neq("id", id).maybeSingle();
        return Boolean(data);
      });
    }
  }

  const before = await pageSlug(supabase, id);
  const { error } = await supabase.from("discovery_pages").update(payload).eq("id", id);
  if (error) redirect(errorRedirectUrl(pagePath(id), error.message));

  await auditPage(supabase, "page_update", id, { slug: (payload.slug as string | undefined) ?? before });
  await revalidatePage(id, before);
  if (payload.slug && payload.slug !== before) revalidatePath(guidePath(payload.slug as string));
  redirect(`${pagePath(id)}?saved=settings`);
}

/** Publish / Unpublish a normal Page. published_at records the FIRST
 * publication (kept on unpublish and re-publish). Coverage dates never
 * publish or unpublish anything. The system Homepage is always published. */
export async function setDiscoveryPagePublished(id: string, publish: boolean) {
  const supabase = await requireAdminSupabase();
  const { data: page } = await supabase.from("discovery_pages").select("id, slug, is_system, is_published, published_at").eq("id", id).maybeSingle();
  if (!page) redirect(LIST_PATH);
  if (page.is_system) redirect(errorRedirectUrl(pagePath(id), "The Homepage is a system page and is always published."));
  if (page.is_published === publish) redirect(`${pagePath(id)}?saved=${publish ? "published" : "unpublished"}`);

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("discovery_pages")
    .update({ is_published: publish, published_at: nextPublishedAt(page.published_at, publish, now), updated_at: now })
    .eq("id", id);
  if (error) redirect(errorRedirectUrl(pagePath(id), error.message));

  await auditPage(supabase, publish ? "page_publish" : "page_unpublish", id, { slug: page.slug });
  await revalidatePage(id, page.slug);
  redirect(`${pagePath(id)}?saved=${publish ? "published" : "unpublished"}`);
}

export async function deleteDiscoveryPage(id: string, isSystem: boolean) {
  if (isSystem) redirect(errorRedirectUrl(pagePath(id), "The Homepage is a system page and cannot be deleted."));
  const supabase = await requireAdminSupabase();

  const { error } = await supabase.from("discovery_pages").delete().eq("id", id);
  if (error) {
    // Most likely cause: the page still has sections (homepage_rows.page_id
    // has no ON DELETE cascade — deliberately, so a page's sections are
    // never silently destroyed by deleting the page). Friendly message
    // instead of a raw FK-violation error.
    redirect(errorRedirectUrl(pagePath(id), "Delete or move this page's sections first."));
  }

  await auditPage(supabase, "page_delete", id);
  revalidatePath(LIST_PATH);
  revalidatePath("/");
  redirect(LIST_PATH);
}

// ── Sections (homepage_rows rows) ───────────────────────────────────────

function readSectionFields(formData: FormData) {
  const sectionType: HomepageRowSectionType = str(formData, "section_type") === "group" ? "group" : "feed";
  const base = {
    title: str(formData, "title") ?? "Untitled Section",
    subtitle: str(formData, "subtitle"),
    section_type: sectionType,
    is_visible: bool(formData, "is_visible"),
  };

  // A Group has no content, filters, or picks of its own — force every
  // feed-only field to its neutral/empty value regardless of what a
  // stray field might contain, rather than trusting the form to omit them.
  if (sectionType === "group") {
    return {
      ...base,
      content_type: null,
      mode: "dynamic" as HomepageRowMode,
      category_slug: null,
      market_slug: null,
      area_slug: null,
      featured_only: false,
      time_window: null,
      item_limit: 8,
      curated_ids: [],
      pinned_ids: [],
    };
  }

  const contentTypeRaw = str(formData, "content_type");
  const modeRaw = str(formData, "mode");
  const timeWindowRaw = str(formData, "time_window");
  return {
    ...base,
    content_type: (CONTENT_TYPES.includes(contentTypeRaw as HomepageRowContentType)
      ? contentTypeRaw
      : "businesses") as HomepageRowContentType,
    mode: (MODES.includes(modeRaw as HomepageRowMode) ? modeRaw : "dynamic") as HomepageRowMode,
    category_slug: str(formData, "category_slug"),
    market_slug: str(formData, "market_slug"),
    area_slug: str(formData, "area_slug"),
    featured_only: bool(formData, "featured_only"),
    time_window: TIME_WINDOWS.includes(timeWindowRaw as HomepageRowTimeWindow) ? (timeWindowRaw as HomepageRowTimeWindow) : null,
    item_limit: num(formData, "item_limit") ?? 8,
    curated_ids: formData.getAll("curated_id").map(String),
    pinned_ids: formData.getAll("pinned_id").map(String),
  };
}

export async function createSection(pageId: string, formData: FormData) {
  const supabase = await requireAdminSupabase();
  const sectionType: HomepageRowSectionType = str(formData, "section_type") === "group" ? "group" : "feed";
  const title = str(formData, "title") ?? (sectionType === "group" ? "New Group" : "New Section");

  const { data: existing } = await supabase
    .from("homepage_rows")
    .select("sort_order")
    .eq("page_id", pageId)
    .is("parent_id", null)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextOrder = (existing?.[0]?.sort_order ?? 0) + 10;

  const { data: created, error } = await supabase
    .from("homepage_rows")
    .insert({
      page_id: pageId,
      title,
      section_type: sectionType,
      content_type: sectionType === "feed" ? "businesses" : null,
      mode: "dynamic",
      is_visible: true,
      sort_order: nextOrder,
    })
    .select("id")
    .single();
  if (error || !created) redirect(errorRedirectUrl(pagePath(pageId), error?.message ?? "Could not add the section."));

  await auditSection(supabase, "page_section_create", created.id, pageId, { section_type: sectionType });
  await revalidatePage(pageId, await pageSlug(supabase, pageId));
  redirect(`${pagePath(pageId)}?saved=created`);
}

export async function saveSection(id: string, pageId: string, formData: FormData) {
  const supabase = await requireAdminSupabase();
  const fields = readSectionFields(formData);
  const { data: before } = await supabase.from("homepage_rows").select("is_visible").eq("id", id).maybeSingle();

  const { error } = await supabase.from("homepage_rows").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) redirect(errorRedirectUrl(pagePath(pageId), error.message));

  await auditSection(supabase, "page_section_update", id, pageId, { section_type: fields.section_type, content_type: fields.content_type, mode: fields.mode });
  if (before && before.is_visible !== fields.is_visible) {
    await auditSection(supabase, fields.is_visible ? "page_section_show" : "page_section_hide", id, pageId);
  }
  await revalidatePage(pageId, await pageSlug(supabase, pageId));
  redirect(`${pagePath(pageId)}?saved=${id}`);
}

export async function deleteSection(id: string, pageId: string) {
  const supabase = await requireAdminSupabase();
  // Deleting a Group detaches (never deletes) its children — see the
  // migration's parent_id ON DELETE SET NULL — they simply return to top
  // level, same as an explicit "Return to Top Level" on each of them.
  const { error } = await supabase.from("homepage_rows").delete().eq("id", id);
  if (error) redirect(errorRedirectUrl(pagePath(pageId), error.message));
  await auditSection(supabase, "page_section_delete", id, pageId);
  await revalidatePage(pageId, await pageSlug(supabase, pageId));
  redirect(pagePath(pageId));
}

// ── Ordering engine ──────────────────────────────────────────────────────
// Every move ends by renumbering the whole affected sibling set to clean
// 10/20/30/… values — the founder never has a raw sort_order to repair,
// and every operation composes safely regardless of how it got there.

async function fetchRowMeta(
  supabase: SupabaseClient,
  id: string
): Promise<{ id: string; page_id: string; parent_id: string | null } | null> {
  const { data } = await supabase.from("homepage_rows").select("id, page_id, parent_id").eq("id", id).maybeSingle();
  return data;
}

async function fetchSiblingIds(supabase: SupabaseClient, pageId: string, parentId: string | null): Promise<string[]> {
  let query = supabase.from("homepage_rows").select("id").eq("page_id", pageId).order("sort_order", { ascending: true });
  query = parentId ? query.eq("parent_id", parentId) : query.is("parent_id", null);
  const { data } = await query;
  return (data ?? []).map((r: { id: string }) => r.id);
}

async function renumberSiblings(supabase: SupabaseClient, ids: string[]) {
  await Promise.all(ids.map((sid, i) => supabase.from("homepage_rows").update({ sort_order: (i + 1) * 10 }).eq("id", sid)));
}

function moveByDelta(ids: string[], id: string, delta: number): string[] {
  const idx = ids.indexOf(id);
  if (idx === -1) return ids;
  const target = idx + delta;
  if (target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  next.splice(idx, 1);
  next.splice(target, 0, id);
  return next;
}

function moveToEdge(ids: string[], id: string, edge: "start" | "end"): string[] {
  const idx = ids.indexOf(id);
  if (idx === -1) return ids;
  const next = [...ids];
  next.splice(idx, 1);
  if (edge === "start") next.unshift(id);
  else next.push(id);
  return next;
}

function placeRelative(ids: string[], id: string, targetId: string, where: "before" | "after"): string[] {
  if (id === targetId) return ids;
  const idx = ids.indexOf(id);
  if (idx === -1 || !ids.includes(targetId)) return ids;
  const next = [...ids];
  next.splice(idx, 1);
  const targetIdx = next.indexOf(targetId);
  if (targetIdx === -1) return ids;
  next.splice(where === "after" ? targetIdx + 1 : targetIdx, 0, id);
  return next;
}

/** `position` is the human-facing 1-indexed ordinal sibling position, not
 * the raw sort_order — moving item 8 to position 3 shifts every affected
 * sibling automatically via the renumber that follows. */
function setPositionIn(ids: string[], id: string, position: number): string[] {
  const idx = ids.indexOf(id);
  if (idx === -1) return ids;
  const next = [...ids];
  next.splice(idx, 1);
  const clamped = Math.max(1, Math.min(Math.round(position), next.length + 1));
  next.splice(clamped - 1, 0, id);
  return next;
}

async function reorderWithinSiblings(id: string, pageId: string, compute: (ids: string[]) => string[], move: string) {
  const supabase = await requireAdminSupabase();
  const meta = await fetchRowMeta(supabase, id);
  if (!meta) redirect(pagePath(pageId));

  const ids = await fetchSiblingIds(supabase, pageId, meta.parent_id);
  const next = compute(ids);
  await renumberSiblings(supabase, next);

  await auditSection(supabase, "page_section_move", id, pageId, { move, position: next.indexOf(id) + 1 });
  await revalidatePage(pageId, await pageSlug(supabase, pageId));
  redirect(pagePath(pageId));
}

export async function moveSectionUp(id: string, pageId: string) {
  await reorderWithinSiblings(id, pageId, (ids) => moveByDelta(ids, id, -1), "up");
}
export async function moveSectionDown(id: string, pageId: string) {
  await reorderWithinSiblings(id, pageId, (ids) => moveByDelta(ids, id, 1), "down");
}
export async function moveSectionTop(id: string, pageId: string) {
  await reorderWithinSiblings(id, pageId, (ids) => moveToEdge(ids, id, "start"), "top");
}
export async function moveSectionBottom(id: string, pageId: string) {
  await reorderWithinSiblings(id, pageId, (ids) => moveToEdge(ids, id, "end"), "bottom");
}
export async function placeSectionBefore(id: string, pageId: string, formData: FormData) {
  const targetId = str(formData, "target_id");
  if (!targetId) redirect(pagePath(pageId));
  await reorderWithinSiblings(id, pageId, (ids) => placeRelative(ids, id, targetId, "before"), "before");
}
export async function placeSectionAfter(id: string, pageId: string, formData: FormData) {
  const targetId = str(formData, "target_id");
  if (!targetId) redirect(pagePath(pageId));
  await reorderWithinSiblings(id, pageId, (ids) => placeRelative(ids, id, targetId, "after"), "after");
}
export async function setSectionPosition(id: string, pageId: string, formData: FormData) {
  const position = num(formData, "position");
  if (position == null) redirect(pagePath(pageId));
  await reorderWithinSiblings(id, pageId, (ids) => setPositionIn(ids, id, position), "position");
}

/** Cross-parent moves: renumbers BOTH the old and new sibling sets — the
 * founder never manually repairs sort_order on either side of a move. The
 * one-level hierarchy itself (target must be a top-level Group, on the
 * same page, and the row being moved must not itself be a Group) is
 * enforced by the DB trigger (migration discovery_pages_foundation) — this
 * function surfaces that as a friendly redirect rather than special-casing
 * the same rules twice. */
async function moveAcrossParent(id: string, pageId: string, newParentId: string | null) {
  const supabase = await requireAdminSupabase();
  const meta = await fetchRowMeta(supabase, id);
  if (!meta) redirect(pagePath(pageId));

  const oldParentId = meta.parent_id;
  const newSiblingIds = await fetchSiblingIds(supabase, pageId, newParentId);
  const nextOrder = (newSiblingIds.length + 1) * 10;

  const { error } = await supabase.from("homepage_rows").update({ parent_id: newParentId, sort_order: nextOrder }).eq("id", id);
  if (error) redirect(errorRedirectUrl(pagePath(pageId), error.message));

  await renumberSiblings(supabase, await fetchSiblingIds(supabase, pageId, oldParentId));
  await renumberSiblings(supabase, await fetchSiblingIds(supabase, pageId, newParentId));

  await auditSection(supabase, "page_section_move", id, pageId, { move: newParentId ? "into_group" : "to_top_level" });
  await revalidatePage(pageId, await pageSlug(supabase, pageId));
  redirect(pagePath(pageId));
}

export async function moveSectionUnderGroup(id: string, pageId: string, formData: FormData) {
  const groupId = str(formData, "group_id");
  if (!groupId) redirect(pagePath(pageId));
  await moveAcrossParent(id, pageId, groupId);
}

export async function returnSectionToTopLevel(id: string, pageId: string) {
  await moveAcrossParent(id, pageId, null);
}
