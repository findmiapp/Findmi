import MarketForm from "../MarketForm";

export const dynamic = "force-dynamic";

export default async function NewMarketPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Add Market</h1>
      <div className="mt-5">
        <MarketForm market={null} error={error} />
      </div>
    </div>
  );
}
