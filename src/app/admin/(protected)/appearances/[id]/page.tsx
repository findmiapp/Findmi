import { notFound } from "next/navigation";
import {
  getAdminAppearanceById,
  getBusinessSelectOptions,
  getEventSelectOptions,
} from "@/lib/admin/queries";
import AppearanceForm from "../AppearanceForm";

export const dynamic = "force-dynamic";

export default async function EditAppearancePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { error, saved } = await searchParams;
  const [appearance, businessOptions, eventOptions] = await Promise.all([
    getAdminAppearanceById(id),
    getBusinessSelectOptions(),
    getEventSelectOptions(),
  ]);
  if (!appearance) notFound();

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
        Edit Appearance
      </h1>
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved.
        </p>
      )}
      <div className="mt-5">
        <AppearanceForm
          appearance={appearance}
          businessOptions={businessOptions}
          eventOptions={eventOptions}
          error={error}
        />
      </div>
    </div>
  );
}
