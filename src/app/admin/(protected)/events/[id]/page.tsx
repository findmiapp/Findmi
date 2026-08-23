import { notFound } from "next/navigation";
import { getAdminEventById } from "@/lib/admin/queries";
import EventForm from "../EventForm";

export const dynamic = "force-dynamic";

export default async function EditEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { error, saved } = await searchParams;
  const result = await getAdminEventById(id);
  if (!result) notFound();

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Edit Event</h1>
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved.
        </p>
      )}
      <div className="mt-5">
        <EventForm event={result.event} participants={result.participants} error={error} />
      </div>
    </div>
  );
}
