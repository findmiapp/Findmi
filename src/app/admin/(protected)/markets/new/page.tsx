import MarketForm from "../MarketForm";

export const dynamic = "force-dynamic";

export default async function NewMarketPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; created?: string }>;
}) {
  const { error, created } = await searchParams;
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Add Market</h1>
      {created && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Market created. Ready for the next one.
        </p>
      )}
      <div className="mt-5">
        <MarketForm market={null} error={error} />
      </div>
    </div>
  );
}
