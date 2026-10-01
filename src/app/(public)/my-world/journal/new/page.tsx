import JournalCreateWizard from "@/components/journal/JournalCreateWizard";
import { getSupabase } from "@/lib/supabase";
import type { JournalSearchResult } from "@/components/journal/JournalSearchSelect";

/** Journal V1 — entry creation from existing Findmi context. Every
 * supplied id is validated server-side against the real row before it's
 * ever used as a prefill default (never trusted at face value) — an
 * invalid/unknown id is silently ignored rather than erroring the whole
 * page, so a stale or tampered link just lands on a normal blank Create
 * flow instead of breaking. No "Document this experience" buttons are
 * added anywhere in this pass — this route accepting the params is the
 * capability; wiring buttons to it on public pages is explicitly future
 * work. */
async function resolvePrefillLocation(id: string | undefined): Promise<JournalSearchResult | null> {
  if (!id) return null;
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.from("locations").select("id, name, city, state, logo_url, cover_image_url").eq("id", id).eq("is_demo", false).maybeSingle();
  if (!data) return null;
  return { value: data.id, label: data.name, sublabel: [data.city, data.state].filter(Boolean).join(", ") || undefined, image_url: data.logo_url ?? data.cover_image_url };
}

async function resolvePrefillBusiness(id: string | undefined): Promise<JournalSearchResult | null> {
  if (!id) return null;
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.from("businesses").select("id, name, logo_url, is_demo, publication_status").eq("id", id).eq("is_demo", false).eq("publication_status", "live").maybeSingle();
  if (!data) return null;
  return { value: data.id, label: data.name, image_url: data.logo_url };
}

async function resolvePrefillProduct(id: string | undefined): Promise<JournalSearchResult | null> {
  if (!id) return null;
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase
    .from("products")
    .select("id, name, image_url, is_active, business:businesses(name, is_demo, publication_status)")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();
  if (!data) return null;
  const business = Array.isArray(data.business) ? (data.business[0] ?? null) : data.business;
  if (!business || business.is_demo || business.publication_status !== "live") return null;
  return { value: data.id, label: data.name, sublabel: business.name, image_url: data.image_url };
}

async function resolvePrefillEvent(id: string | undefined): Promise<JournalSearchResult | null> {
  if (!id) return null;
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.from("events").select("id, name, cover_image_url, city, state, is_demo").eq("id", id).eq("is_demo", false).maybeSingle();
  if (!data) return null;
  return { value: data.id, label: data.name, sublabel: [data.city, data.state].filter(Boolean).join(", ") || undefined, image_url: data.cover_image_url };
}

export default async function NewJournalEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string; business?: string; product?: string; event?: string }>;
}) {
  const params = await searchParams;
  const [prefillLocation, prefillBusiness, prefillProduct, prefillEvent] = await Promise.all([
    resolvePrefillLocation(params.location),
    resolvePrefillBusiness(params.business),
    resolvePrefillProduct(params.product),
    resolvePrefillEvent(params.event),
  ]);

  return (
    <JournalCreateWizard
      prefillLocation={prefillLocation}
      prefillBusiness={prefillBusiness}
      prefillProduct={prefillProduct}
      prefillEvent={prefillEvent}
    />
  );
}
