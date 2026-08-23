import { getBusinessSelectOptions, getEventSelectOptions } from "@/lib/admin/queries";
import AppearanceForm from "../AppearanceForm";

export const dynamic = "force-dynamic";

export default async function NewAppearancePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const [businessOptions, eventOptions] = await Promise.all([
    getBusinessSelectOptions(),
    getEventSelectOptions(),
  ]);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
        Add Appearance
      </h1>
      <div className="mt-5">
        <AppearanceForm
          appearance={null}
          businessOptions={businessOptions}
          eventOptions={eventOptions}
          error={error}
        />
      </div>
    </div>
  );
}
