import { redirect, notFound } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { startOrResumeEventJournalEntry } from "../journalCaptureActions";

export const dynamic = "force-dynamic";

/** Event Action UX + Universal Journal CTA pass — the "Document Your
 * Experience" entry point every public Event page links to. A plain GET
 * page (not gated by middleware — only /admin, /account, and
 * /my-world/journal are; see src/middleware.ts), same "check auth the
 * manual way, bounce to the existing signup gateway if missing" shape
 * /join/start's own page already establishes, reused here rather than
 * inventing a second auth-gate pattern.
 *
 * Signed out: sends the visitor through the existing /signup?next=
 * gateway with this exact URL preserved, so after authenticating they
 * land right back here and continue into the same event's Journal flow —
 * no second signup flow, no new redirect architecture.
 *
 * Signed in: resolves (or creates) the one Journal entry for this user
 * and event via the existing create-or-resume logic, then continues to
 * whichever existing surface already fits the result — the public entry
 * itself if already published, the admin capture surface for an admin's
 * own draft, or the existing self-serve editor for an ordinary
 * consumer's own draft. Never renders any UI of its own.
 * (Public Event V2: published entries now also open the editor — see
 * below.) */
export default async function EventJournalEntryPointPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/signup?next=${encodeURIComponent(`/event/${slug}/journal`)}`);
  }

  const result = await startOrResumeEventJournalEntry(slug);
  if ("error" in result) notFound();

  // Public Event V2 — "Add Moment" / "Add More" always open the editor so
  // the user can actually add to their entry, published or not (the
  // consumer editor and the admin capture surface both accept published
  // entries). The read-only public entry is linked separately on the Event
  // page ("View your Journal").
  redirect(result.isAdmin ? `/admin/journal/${result.id}/capture` : `/my-world/journal/${result.id}/edit`);
}
