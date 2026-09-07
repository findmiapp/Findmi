import { notFound } from "next/navigation";
import { getAdminMarketById } from "@/lib/admin/markets";
import AreaForm from "../../../AreaForm";

export const dynamic = "force-dynamic";

export default async function NewAreaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const market = await getAdminMarketById(id);
  if (!market) notFound();

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Add Area</h1>
      <div className="mt-5">
        <AreaForm marketId={market.id} marketName={market.display_name || market.name} area={null} error={error} />
      </div>
    </div>
  );
}
