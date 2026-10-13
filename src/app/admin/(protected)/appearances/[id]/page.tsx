import { notFound } from "next/navigation";
import {
  getAdminAppearanceById,
  getBusinessOptionById,
  getEventOptionById,
  getLocationOptionById,
} from "@/lib/admin/queries";
import { getActiveMarketsWithAreaOptions } from "@/lib/admin/market-areas";
import Link from "next/link";
import AppearanceForm from "../AppearanceForm";
import { convertAppearanceFromAdminPage } from "../convert-actions";

export const dynamic = "force-dynamic";

export default async function EditAppearancePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; converted?: string; convertError?: string; convertNote?: string }>;
}) {
  const { id } = await params;
  const { error, saved, converted, convertError, convertNote } = await searchParams;
  const appearance = await getAdminAppearanceById(id);
  if (!appearance) notFound();

  const [initialBusiness, initialEvent, initialLocation, marketsWithAreas] = await Promise.all([
    getBusinessOptionById(appearance.business_id),
    getEventOptionById(appearance.event_id),
    getLocationOptionById(appearance.location_id),
    getActiveMarketsWithAreaOptions(),
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
      {converted && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Converted to an Event awaiting review.{" "}
          <Link href={`/admin/events/${converted}`} className="font-semibold underline">
            Review Event
          </Link>
          {convertNote === "image" ? " The Event image couldn’t be recovered; none was substituted." : ""}
        </p>
      )}
      {convertError && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">Not converted — {convertError}</p>}
      {/* Rich Appearance → Event conversion: only a standalone item with
          its own source link. Re-reads that link, checks it is the same
          Event, then creates the Event (pending review) and links THIS
          item to it — Business stays a participant, never host. */}
      {!appearance.event_id && appearance.external_url && !converted && (
        <form action={convertAppearanceFromAdminPage.bind(null, appearance.id)} className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-black/10 bg-white px-4 py-3">
          <p className="min-w-0 flex-1 text-sm text-ink/70">Re-read its source link and make this a Findmi Event (pending review), keeping this item.</p>
          <button type="submit" className="rounded-lg border border-black/15 px-3 py-1.5 text-sm font-semibold text-ink hover:border-findmi/50">
            Convert To Event
          </button>
        </form>
      )}
      <div className="mt-5">
        <AppearanceForm
          appearance={appearance}
          initialBusiness={initialBusiness}
          initialEvent={initialEvent}
          initialLocation={initialLocation}
          marketsWithAreas={marketsWithAreas}
          error={error}
        />
      </div>
    </div>
  );
}
