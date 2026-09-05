import { notFound } from "next/navigation";
import { getAdminMarketById } from "@/lib/admin/markets";
import MarketForm from "../MarketForm";

export const dynamic = "force-dynamic";

export default async function EditMarketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { error, saved } = await searchParams;
  const market = await getAdminMarketById(id);
  if (!market) notFound();

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Edit Market</h1>
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved.
        </p>
      )}
      <div className="mt-5">
        <MarketForm market={market} error={error} />
      </div>
    </div>
  );
}
