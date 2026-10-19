import { redirect, notFound } from "next/navigation";
import { getEventBySlug } from "@/lib/data";

export const dynamic = "force-dynamic";

/** The Add Moment entry point every public Event page links to. Moments
 * V2: always starts a NEW Moment with this Event prefilled (the composer
 * at /my-world/journal/new resolves the Event's date/Location/host as
 * removable prefills) — it never reopens or edits an existing Moment.
 *
 * No auth logic here: the composer is guest-capable and only asks a
 * guest for an account at its final Save/Publish. (This route used to
 * redirect a signed-out visitor to /signup before the composer could
 * open.) */
export default async function EventJournalEntryPointPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const event = await getEventBySlug(slug);
  if (!event) notFound();

  redirect(`/my-world/journal/new?event=${encodeURIComponent(event.id)}`);
}
