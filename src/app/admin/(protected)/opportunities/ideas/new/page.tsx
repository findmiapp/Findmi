import Link from "next/link";
import IdeaForm from "../IdeaForm";
import { createIdea } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewIdeaPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-ink/45">
        <Link href="/admin/opportunities/ideas" className="hover:underline">
          Ideas
        </Link>
        <span>/</span>
        <span>New</span>
      </div>
      <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">New Opportunity Idea</h1>
      <p className="mt-1 text-sm text-ink/50">A strategy or channel to ask Brands about. Saves as a Draft unless you publish it.</p>
      {error && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <div className="mt-5">
        <IdeaForm idea={null} targets={[]} action={createIdea} saveLabel="Create Idea" cancelHref="/admin/opportunities/ideas" />
      </div>
    </div>
  );
}
