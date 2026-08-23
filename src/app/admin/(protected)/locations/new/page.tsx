import LocationForm from "../LocationForm";

export const dynamic = "force-dynamic";

export default async function NewLocationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Add Location</h1>
      <div className="mt-5">
        <LocationForm location={null} error={error} />
      </div>
    </div>
  );
}
