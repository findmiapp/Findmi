import { notFound } from "next/navigation";
import { getAdminMarketById } from "@/lib/admin/markets";
import AreaForm from "../../../AreaForm";

export const dynamic = "force-dynamic";

export default async function NewAreaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; created?: string }>;
}) {
  const { id } = await params;
  const { error, created } = await searchParams;
  const market = await getAdminMarketById(id);
  if (!market) notFound();

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Add Area</h1>
      {created && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Area created. Ready for the next one in {market.display_name || market.name}.
        </p>
      )}
      <div className="mt-5">
        <AreaForm marketId={market.id} marketName={market.display_name || market.name} area={null} error={error} />
      </div>
    </div>
  );
}
