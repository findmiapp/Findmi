import { notFound, redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getOwnJournalEntryOrNull } from "@/lib/journal";
import JournalEditForm from "@/components/journal/JournalEditForm";

export const dynamic = "force-dynamic";

/** Journal V1 — Edit own Journal Entry. Ownership is re-verified here
 * (getOwnJournalEntryOrNull, itself backed by the same RLS every other
 * Journal read already relies on) — a non-owner who somehow reaches this
 * URL gets a plain 404, never a redirect that would confirm the entry's
 * existence to them. */
export default async function EditJournalEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=" + encodeURIComponent(`/my-world/journal/${id}/edit`));

  const result = await getOwnJournalEntryOrNull(id, user.id);
  if (!result) notFound();

  return <JournalEditForm entryId={id} entry={result} />;
}
