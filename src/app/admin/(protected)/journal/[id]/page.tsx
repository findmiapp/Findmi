import { notFound } from "next/navigation";
import { getJournalEntryWithRelationsForAdmin } from "@/lib/journal";
import JournalEditForm from "@/components/journal/JournalEditForm";

export const dynamic = "force-dynamic";

/** Journal Pass 1 — the canonical admin editor for ONE existing Journal
 * Entry, reached from the public entry's own edit-pencil control
 * (src/app/(public)/journal/[id]/page.tsx). Already behind the standard
 * /admin middleware gate (src/middleware.ts), same as every other
 * /admin/<entity>/[id] edit route (see e.g. admin/(protected)/locations/
 * [id]/page.tsx) — no additional in-page admin check is added here, same
 * convention those pages already follow for GET.
 *
 * Reuses JournalEditForm completely unchanged — no second editor, no
 * feature-set expansion. Its own Save flow calls the exact same Server
 * Actions (saveJournalBasics/saveJournalLocation/saveJournalConnections/
 * updateJournalVisibility) the consumer Edit page already uses; those
 * actions' shared requireOwnEntry() helper now also accepts an authorized
 * admin session as an alternate path (see that file's own comment), which
 * is what actually lets this page's Save button work for an entry this
 * admin doesn't personally own.
 *
 * Data is loaded via getJournalEntryWithRelationsForAdmin — the
 * service-role variant of the public page's own data call — so this works
 * for ANY entry regardless of owner/visibility/status, including an
 * unpublished draft the owner-only RLS path would never return to anyone
 * else. */
export default async function AdminJournalEntryEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = await getJournalEntryWithRelationsForAdmin(id);
  if (!entry) notFound();

  return <JournalEditForm entryId={id} entry={entry} />;
}
