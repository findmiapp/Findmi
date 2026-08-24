import { getAdminSupabase } from "./supabase-admin";
import type { FindmiForm, FormAssignment, FormEntityType, FormPurpose } from "@/lib/types";

export interface AdminFormRow extends FindmiForm {
  assignmentCount: number;
}

export async function getAdminForms(filters: { purpose?: FormPurpose } = {}): Promise<AdminFormRow[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];

  let query = supabase.from("forms").select("*").order("purpose").order("name");
  if (filters.purpose) query = query.eq("purpose", filters.purpose);
  const { data: forms } = await query;
  if (!forms || forms.length === 0) return [];

  const { data: assignments } = await supabase
    .from("form_assignments")
    .select("form_id")
    .in(
      "form_id",
      forms.map((f) => f.id)
    );
  const counts = new Map<string, number>();
  for (const a of assignments ?? []) counts.set(a.form_id, (counts.get(a.form_id) ?? 0) + 1);

  return forms.map((f) => ({ ...f, assignmentCount: counts.get(f.id) ?? 0 }));
}

export async function getAdminFormById(id: string): Promise<FindmiForm | null> {
  const supabase = getAdminSupabase();
  if (!supabase) return null;
  const { data } = await supabase.from("forms").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

export interface AssignmentRow extends FormAssignment {
  entityLabel: string;
}

/** Resolves each assignment's entity_id to a human label by looking it up
 * in whichever table entity_type points at — three small bounded IN
 * queries (one per entity type actually present among this form's
 * assignments), never a full-table scan. */
export async function getAssignmentsForForm(formId: string): Promise<AssignmentRow[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data: assignments } = await supabase
    .from("form_assignments")
    .select("*")
    .eq("form_id", formId)
    .order("created_at", { ascending: false });
  if (!assignments || assignments.length === 0) return [];

  const idsByType: Record<FormEntityType, string[]> = { business: [], event: [], product: [] };
  for (const a of assignments) idsByType[a.entity_type as FormEntityType].push(a.entity_id);

  const labels = new Map<string, string>();
  if (idsByType.business.length) {
    const { data } = await supabase.from("businesses").select("id, name").in("id", idsByType.business);
    for (const b of data ?? []) labels.set(b.id, b.name);
  }
  if (idsByType.event.length) {
    const { data } = await supabase.from("events").select("id, name").in("id", idsByType.event);
    for (const e of data ?? []) labels.set(e.id, e.name);
  }
  if (idsByType.product.length) {
    const { data } = await supabase.from("products").select("id, name").in("id", idsByType.product);
    for (const p of data ?? []) labels.set(p.id, p.name);
  }

  return assignments.map((a) => ({ ...a, entityLabel: labels.get(a.entity_id) ?? "Unknown" }));
}
