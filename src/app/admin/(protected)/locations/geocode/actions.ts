"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { requeueLocation, runGeocodeBatch, setManualCoordinate } from "@/lib/geo/geocode";
import { isValidCoordinate } from "@/lib/discovery/map-core";

const PATH = "/admin/locations/geocode";
const back = (msg: string) => redirect(`${PATH}?result=${encodeURIComponent(msg)}`);

/** One bounded batch — the controlled backfill for existing Locations. */
export async function placeNextBatch(formData: FormData) {
  const admin = await requireAdminSupabase();
  const limit = Number(formData.get("limit")) || 10;
  let msg: string;
  try {
    const s = await runGeocodeBatch(admin, { limit });
    msg = `Checked ${s.processed} with ${s.provider}: ${s.resolved} placed, ${s.ambiguous} need a choice, ${s.incomplete} incomplete, ${s.failed} failed${s.skipped ? `, ${s.skipped} changed meanwhile` : ""}. ${s.remaining} still queued.`;
  } catch (e) {
    msg = e instanceof Error ? e.message : "Placement failed.";
  }
  revalidatePath(PATH);
  back(msg);
}

export async function retryLocation(formData: FormData) {
  const admin = await requireAdminSupabase();
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) back("Unknown Location.");
  await requeueLocation(admin, id);
  const s = await runGeocodeBatch(admin, { ids: [id], limit: 1 });
  revalidatePath(PATH);
  back(s.resolved ? "Placed on the map." : "Still not placed — see the reason below, or set the pin by hand.");
}

/** Manual correction: the database records it as a 'manual' pin. */
export async function setPin(formData: FormData) {
  const admin = await requireAdminSupabase();
  const id = String(formData.get("id") ?? "");
  const lat = Number(String(formData.get("latitude") ?? "").trim());
  const lng = Number(String(formData.get("longitude") ?? "").trim());
  if (!/^[0-9a-f-]{36}$/i.test(id) || !isValidCoordinate(lat, lng)) back("Enter a valid latitude and longitude.");
  const ok = await setManualCoordinate(admin, id, lat, lng);
  revalidatePath(PATH);
  back(ok ? "Pin set by hand." : "Couldn't save that pin.");
}
