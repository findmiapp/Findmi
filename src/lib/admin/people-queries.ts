import { getAdminSupabase } from "./supabase-admin";
import type { Person } from "@/lib/types";

export interface AdminPersonListFilters {
  q?: string;
}

export async function getAdminPeople(filters: AdminPersonListFilters = {}): Promise<Person[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  let query = supabase.from("people").select("*").order("name");
  if (filters.q) {
    const term = `%${filters.q}%`;
    query = query.or(`name.ilike.${term},short_bio.ilike.${term}`);
  }
  const { data } = await query;
  return data ?? [];
}

export async function getAdminPersonById(id: string): Promise<Person | null> {
  const supabase = getAdminSupabase();
  if (!supabase) return null;
  const { data } = await supabase.from("people").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

export interface PersonBusinessRow {
  business_id: string;
  business_name: string;
  logo_url: string | null;
  role: string | null;
  display_order: number | null;
  featured: boolean;
  show_on_business: boolean;
}

export async function getBusinessesForPersonAdmin(personId: string): Promise<PersonBusinessRow[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from("business_people")
    .select("business_id, role, display_order, featured, show_on_business, businesses(name, logo_url)")
    .eq("person_id", personId)
    .order("display_order", { ascending: true, nullsFirst: false });

  type Row = {
    business_id: string;
    role: string | null;
    display_order: number | null;
    featured: boolean;
    show_on_business: boolean;
    businesses: { name: string; logo_url: string | null } | { name: string; logo_url: string | null }[] | null;
  };
  return ((data ?? []) as Row[]).map((row) => {
    const business = Array.isArray(row.businesses) ? row.businesses[0] : row.businesses;
    return {
      business_id: row.business_id,
      business_name: business?.name ?? "Unknown business",
      logo_url: business?.logo_url ?? null,
      role: row.role,
      display_order: row.display_order,
      featured: row.featured,
      show_on_business: row.show_on_business,
    };
  });
}
