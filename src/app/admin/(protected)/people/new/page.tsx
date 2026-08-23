import PersonForm from "../PersonForm";

export const dynamic = "force-dynamic";

export default async function NewPersonPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Add Person</h1>
      <div className="mt-5">
        <PersonForm person={null} businesses={[]} error={error} />
      </div>
    </div>
  );
}
