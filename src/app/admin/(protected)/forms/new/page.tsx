import FormDefinitionForm from "../FormDefinitionForm";

export const dynamic = "force-dynamic";

export default async function NewFormPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Add Form</h1>
      <div className="mt-5">
        <FormDefinitionForm form={null} error={error} />
      </div>
    </div>
  );
}
