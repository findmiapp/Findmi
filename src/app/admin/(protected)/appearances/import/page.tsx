import { getBusinessOptionById } from "@/lib/admin/queries";
import { isAnthropicConfigured } from "@/lib/admin/appearance-import";
import ImportForm from "./ImportForm";

export const dynamic = "force-dynamic";

export default async function ImportAppearancesPage({
  searchParams,
}: {
  searchParams: Promise<{ business?: string; error?: string }>;
}) {
  const { business, error } = await searchParams;
  const initialBusiness = await getBusinessOptionById(business ?? null);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Import Appearances</h1>
      <p className="mt-1 max-w-xl text-sm text-ink/55">
        Paste a schedule (text, email, caption) and/or upload flyers or screenshots — Claude reads it and
        drafts individual Appearance records for one Business. Nothing is created until you review and
        select which ones to keep.
      </p>

      {error && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      {!isAnthropicConfigured() && (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Anthropic isn&rsquo;t configured on the server yet — set <code>ANTHROPIC_API_KEY</code> in the
          environment to enable this page.
        </p>
      )}

      <div className="mt-5">
        <ImportForm initialBusiness={initialBusiness} />
      </div>
    </div>
  );
}
