import { getActiveMarketsWithAreaOptions } from "@/lib/admin/market-areas";
import { getAllCategories } from "@/lib/admin/queries";
import LocationForm from "../LocationForm";

export const dynamic = "force-dynamic";

export default async function NewLocationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const [marketsWithAreas, categories] = await Promise.all([
    getActiveMarketsWithAreaOptions(),
    getAllCategories("location"),
  ]);
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Add Location</h1>
      <div className="mt-5">
        <LocationForm location={null} marketsWithAreas={marketsWithAreas} categories={categories} error={error} />
      </div>
    </div>
  );
}
