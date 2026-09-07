import { notFound } from "next/navigation";
import { getAdminMarketById } from "@/lib/admin/markets";
import { getAdminMarketAreaById } from "@/lib/admin/market-areas";
import AreaForm from "../../../AreaForm";

export const dynamic = "force-dynamic";

export default async function EditAreaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; areaId: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id, areaId } = await params;
  const { error, saved } = await searchParams;
  const [market, area] = await Promise.all([getAdminMarketById(id), getAdminMarketAreaById(areaId)]);
  if (!market || !area || area.market_id !== market.id) notFound();

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Edit Area</h1>
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved.
        </p>
      )}
      <div className="mt-5">
        <AreaForm marketId={market.id} marketName={market.display_name || market.name} area={area} error={error} />
      </div>
    </div>
  );
}
