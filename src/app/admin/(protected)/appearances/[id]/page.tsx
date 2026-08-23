import { notFound } from "next/navigation";
import {
  getAdminAppearanceById,
  getBusinessOptionById,
  getEventOptionById,
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
  const appearance = await getAdminAppearanceById(id);
  if (!appearance) notFound();

  const [initialBusiness, initialEvent] = await Promise.all([
    getBusinessOptionById(appearance.business_id),
    getEventOptionById(appearance.event_id),
  ]);

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
          initialBusiness={initialBusiness}
          initialEvent={initialEvent}
          error={error}
        />
      </div>
    </div>
  );
}
