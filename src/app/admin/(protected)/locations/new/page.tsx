import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getAllMarketsForAdmin } from "@/lib/admin/business-markets";
import LocationForm from "../LocationForm";

export const dynamic = "force-dynamic";

export default async function NewLocationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const marketsAdmin = getAdminSupabase();
  const markets = marketsAdmin ? await getAllMarketsForAdmin(marketsAdmin) : [];
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Add Location</h1>
      <div className="mt-5">
        <LocationForm location={null} markets={markets} error={error} />
      </div>
    </div>
  );
}
