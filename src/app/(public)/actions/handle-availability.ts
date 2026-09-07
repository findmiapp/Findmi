"use server";

// Live username availability — called directly from UsernameField (a
// client component), the same "plain async function imported into a
// client component, no API route" pattern requestMissingArea already uses
// (see actions/area-requests.ts + AreaPicker.tsx). Read-only: this never
// claims/reserves anything — a handle only ever becomes owned via a real
// authenticated save (claimEntityHandle, behind requireBusinessMember/
// requireLocationMember/requireEventMember). Business/Location/Event only
// — personal accounts/profiles do not participate in this registry.
import { getSupabase } from "@/lib/supabase";
import { validateUsername } from "@/lib/username";
import type { HandleEntityType } from "@/lib/handles";

export type HandleAvailability =
  | { status: "invalid"; message: string }
  | { status: "reserved"; message: string }
  | { status: "available"; message: string }
  | { status: "taken"; message: string }
  | { status: "unknown"; message: string };

/** `current` (the entity already being edited) means a value matching its
 * OWN existing handle reports "available" rather than a confusing "taken"
 * — checking a username against yourself is not a collision. */
export async function checkHandleAvailability(
  raw: string,
  current?: { entityType: HandleEntityType; entityId: string }
): Promise<HandleAvailability> {
  const validation = validateUsername(raw);
  if (!validation.ok) {
    // validateUsername's own reserved-word message and format message are
    // both plain, non-leaking text already — only the reserved case gets
    // its own status here so the UI can style/word it distinctly per the
    // task's own required "That username is reserved." case.
    const message = validation.error ?? "Invalid username.";
    return { status: message === "That username isn't available." ? "reserved" : "invalid", message };
  }

  const supabase = getSupabase();
  if (!supabase) return { status: "unknown", message: "Couldn't check availability right now." };

  const { data } = await supabase.from("public_handles").select("entity_type, entity_id").eq("handle", validation.value).maybeSingle();

  if (!data) return { status: "available", message: `findmi.app/${validation.value} is available` };
  if (current && data.entity_type === current.entityType && data.entity_id === current.entityId) {
    return { status: "available", message: `findmi.app/${validation.value} is available` };
  }
  return { status: "taken", message: "That username is already taken." };
}
