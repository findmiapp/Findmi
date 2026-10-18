"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { bool, num, str } from "@/lib/admin/form-helpers";
import { validateTopicQuery } from "@/lib/discovery/query";

const PATH = "/admin/site/discovery";
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const fail = (msg: string): never => redirect(`${PATH}?error=${encodeURIComponent(msg)}`);
const done = () => {
  revalidatePath(PATH);
  revalidatePath("/");
  redirect(`${PATH}?saved=1`);
};

function topicFields(formData: FormData) {
  const name = str(formData, "name");
  if (!name || name.length > 60) fail("A Topic needs a name (60 characters max).");
  let query: unknown;
  try {
    query = JSON.parse(str(formData, "query") ?? "{}");
  } catch {
    fail("The query isn't valid JSON.");
  }
  const v = validateTopicQuery(query);
  if (!v.ok) fail(`Query: ${v.error}`);
  const aliases = (str(formData, "aliases") ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean)
    .slice(0, 20);
  return {
    name: name!,
    description: str(formData, "description"),
    image_url: str(formData, "image_url"),
    aliases,
    query: v.ok ? v.value : {},
    is_active: bool(formData, "is_active"),
    sort_order: num(formData, "sort_order") ?? 100,
  };
}

export async function saveTopicAction(formData: FormData) {
  const admin = await requireAdminSupabase();
  const id = str(formData, "id");
  const fields = topicFields(formData);
  if (id) {
    const { error } = await admin.from("discovery_topics").update(fields).eq("id", id);
    if (error) fail(error.message);
  } else {
    const slug = str(formData, "slug")?.toLowerCase() ?? "";
    if (!SLUG.test(slug)) fail("Slug: lowercase letters, numbers and dashes.");
    const { error } = await admin.from("discovery_topics").insert({ ...fields, slug });
    if (error) fail(error.code === "23505" ? "That slug is already used." : error.message);
  }
  done();
}

export async function saveLaneAction(formData: FormData) {
  const admin = await requireAdminSupabase();
  const id = str(formData, "id");
  if (!id) fail("Missing Lane.");
  const title = str(formData, "title");
  if (!title || title.length > 60) fail("A Lane needs a title (60 characters max).");
  const limit = Math.min(24, Math.max(1, num(formData, "item_limit") ?? 12));
  const patch: Record<string, unknown> = { title, subtitle: str(formData, "subtitle"), is_visible: bool(formData, "is_visible"), sort_order: num(formData, "sort_order") ?? 100, item_limit: limit };
  const topicId = str(formData, "topic_id");
  if (topicId) patch.topic_id = topicId;
  const topicSlugs = str(formData, "topic_slugs");
  if (topicSlugs !== null) {
    const slugs = topicSlugs.split(",").map((s) => s.trim()).filter(Boolean);
    const { data } = await admin.from("discovery_topics").select("id, slug").in("slug", slugs);
    const byslug = new Map(((data ?? []) as { id: string; slug: string }[]).map((t) => [t.slug, t.id]));
    const ids = slugs.map((s) => byslug.get(s)).filter((x): x is string => Boolean(x));
    if (ids.length === 0) fail("List at least one existing Topic slug.");
    patch.topic_ids = ids;
  }
  const { error } = await admin.from("discovery_lanes").update(patch).eq("id", id!);
  if (error) fail(error.message);
  done();
}

/** Discovery Lanes Placement & Density Refinement pass — single-select
 * "Primary Discovery" control. Touches ONLY the placement column (never
 * title/subtitle/order/items/visible/topics) on this Lane and on
 * whichever Lane previously held "primary" on the same page — every
 * other Lane setting is left exactly as the founder last saved it. The
 * DB's own partial unique index (one "primary" per page_id) is the real
 * backstop; the demote-then-promote order here just keeps a normal
 * request from tripping it. */
export async function setPrimaryLaneAction(formData: FormData) {
  const admin = await requireAdminSupabase();
  const id = str(formData, "id");
  if (!id) fail("Missing Lane.");
  const { data: lane, error: laneErr } = await admin.from("discovery_lanes").select("page_id").eq("id", id!).maybeSingle();
  if (laneErr || !lane) fail("Lane not found.");
  const { page_id } = lane as { page_id: string };
  const { error: demoteErr } = await admin.from("discovery_lanes").update({ placement: "explore_more" }).eq("page_id", page_id).eq("placement", "primary");
  if (demoteErr) fail(demoteErr.message);
  const { error: promoteErr } = await admin.from("discovery_lanes").update({ placement: "primary" }).eq("id", id!);
  if (promoteErr) fail(promoteErr.message);
  done();
}

/** Event attributes Discovery filters on — explicit, never inferred:
 * unknown stays null (not shown as Free / Family Friendly). */
export async function saveEventAttributesAction(formData: FormData) {
  const admin = await requireAdminSupabase();
  const id = str(formData, "id");
  if (!id) fail("Missing Event.");
  const tri = (k: string) => {
    const v = str(formData, k);
    return v === "yes" ? true : v === "no" ? false : null;
  };
  const { error } = await admin.from("events").update({ is_free: tri("is_free"), family_friendly: tri("family_friendly") }).eq("id", id!);
  if (error) fail(error.message);
  revalidatePath(PATH);
  redirect(`${PATH}?saved=1&event_q=${encodeURIComponent(str(formData, "event_q") ?? "")}#events`);
}
