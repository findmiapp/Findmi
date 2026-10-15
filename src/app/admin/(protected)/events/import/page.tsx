import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdminSession } from "@/lib/admin/auth";
import { getAllCategories } from "@/lib/admin/queries";
import AdminEventImporter from "./AdminEventImporter";

export const dynamic = "force-dynamic";
// Several pasted Events read with the AI assist (bounded inside 60s).
export const maxDuration = 60;

/** Admin Event Import — founder/operator ingestion of public third-party
 * Events through the one Event Import engine. No Business is chosen up
 * front: each Event is reviewed with its own Business (or none). */
export default async function AdminEventImportPage() {
  // Middleware already guards /admin; checked again here (fail closed).
  if (!(await isAdminSession())) redirect("/admin/login");
  const [categories, formats, businessCategories] = await Promise.all([getAllCategories("event"), getAllCategories("event_format"), getAllCategories("business")]);
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4">
      <Link href="/admin/events" className="w-fit text-xs font-semibold text-ink/50 hover:text-ink">
        ← Events
      </Link>
      <AdminEventImporter categories={categories} formats={formats} businessCategories={businessCategories} />
    </div>
  );
}
