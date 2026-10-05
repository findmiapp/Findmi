import { redirect, notFound } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getEventBySlug } from "@/lib/data";

export const dynamic = "force-dynamic";

/** The Add Moment entry point every public Event page links to. Moments
 * V2: always starts a NEW Moment with this Event prefilled (the composer
 * at /my-world/journal/new resolves the Event's date/Location/host as
 * removable prefills) — it never reopens or edits an existing Moment.
 *
 * Signed out: sends the visitor through the existing /signup?next=
 * gateway with this exact URL preserved, so after authenticating they
 * land right back here and continue into the same Event's Moment. */
export default async function EventJournalEntryPointPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/signup?next=${encodeURIComponent(`/event/${slug}/journal`)}`);
  }

  const event = await getEventBySlug(slug);
  if (!event) notFound();

  redirect(`/my-world/journal/new?event=${encodeURIComponent(event.id)}`);
}
