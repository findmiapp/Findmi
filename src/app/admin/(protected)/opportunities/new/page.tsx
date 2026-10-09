import Link from "next/link";
import OpportunityForm from "../OpportunityForm";
import { createOpportunity } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewOpportunityPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-ink/45">
        <Link href="/admin/opportunities" className="hover:underline">
          Opportunities
        </Link>
        <span>/</span>
        <span>New</span>
      </div>
      <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">Add Opportunity</h1>
      <p className="mt-1 text-sm text-ink/50">Saves as a Draft. Open it when it&rsquo;s ready to send to Businesses.</p>
      {error && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <div className="mt-5">
        <OpportunityForm
          listing={null}
          initialOptions={[]}
          legacyUnclassified={false}
          initialLocation={null}
          initialEvent={null}
          action={createOpportunity}
          saveLabel="Save Draft"
          cancelHref="/admin/opportunities"
        />
      </div>
    </div>
  );
}
