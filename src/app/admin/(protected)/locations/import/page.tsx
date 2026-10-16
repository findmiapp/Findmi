import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdminSession } from "@/lib/admin/auth";
import { getAllCategories } from "@/lib/admin/queries";
import LocationImporter from "./LocationImporter";

export const dynamic = "force-dynamic";
// Several Location websites read (2 at a time), each bounded by safe fetch.
export const maxDuration = 60;

/** Admin → Locations → Import Locations — Location Import V1. Match
 * before create: existing places are reused, uncertain ones go to the
 * operator, and new ones are created unlisted (Needs Review). */
export default async function AdminLocationImportPage() {
  // Middleware already guards /admin; checked again here (fail closed).
  if (!(await isAdminSession())) redirect("/admin/login");
  const categories = await getAllCategories("location");
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4">
      <Link href="/admin/locations" className="w-fit text-xs font-semibold text-ink/50 hover:text-ink">
        ← Locations
      </Link>
      <LocationImporter categories={categories} />
    </div>
  );
}
