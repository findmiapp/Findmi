import { notFound } from "next/navigation";
import { getAdminPersonById, getBusinessesForPersonAdmin } from "@/lib/admin/people-queries";
import ViewPublicPageLink from "@/components/admin/ViewPublicPageLink";
import PersonForm from "../PersonForm";

export const dynamic = "force-dynamic";

export default async function EditPersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { error, saved } = await searchParams;
  const [person, businesses] = await Promise.all([getAdminPersonById(id), getBusinessesForPersonAdmin(id)]);
  if (!person) notFound();
  const publicHref = person.is_public ? `/people/${person.slug}` : null;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Edit Person</h1>
        <ViewPublicPageLink href={publicHref} />
      </div>
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved.
        </p>
      )}
      <div className="mt-5">
        <PersonForm person={person} businesses={businesses} error={error} />
      </div>
    </div>
  );
}
