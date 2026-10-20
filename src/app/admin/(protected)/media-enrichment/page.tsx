import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAdminSession } from "@/lib/admin/auth";
import MediaEnrichmentTable from "./MediaEnrichmentTable";

export const dynamic = "force-dynamic";
// Each row is one server-side fetch + store; rows are processed one at a time.
export const maxDuration = 60;

export const metadata: Metadata = { title: "Media Enrichment" };

/** Admin Media Enrichment — attach chosen source images to EXISTING
 * Places, Events and Businesses through Findmi's image pipeline. */
export default async function MediaEnrichmentPage() {
  // Middleware already guards /admin; checked again here (fail closed).
  if (!(await isAdminSession())) redirect("/admin/login");
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Media Enrichment</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink/60">
          Attach an image you&apos;ve chosen from an official source to an existing Place, Event or Business. Findmi downloads it on the server,
          checks it, stores it in Findmi media (with its smaller versions) and sets it on the record — the same result as uploading it on the
          record&apos;s edit page.
        </p>
      </div>
      <MediaEnrichmentTable />
    </div>
  );
}
