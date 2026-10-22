import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getEntityMoments, type EntityMomentKind } from "@/lib/entity-moments";
import EntityMomentRow from "./EntityMomentRow";

/** "Moments On This Page" for a Location or Event manager: the public Moments connected to
 * the page, each with a Show / Hide / Feature control for owners and managers (Staff see the
 * state read-only). Hiding is this page's own display choice — the Moment, its author and
 * every other page are untouched. */
export default async function EntityMomentsSection({ kind, entityId, canManage }: { kind: EntityMomentKind; entityId: string; canManage: boolean }) {
  const admin = getAdminSupabase();
  const moments = admin ? await getEntityMoments(admin, kind, entityId) : [];
  return (
    <section aria-labelledby={`${kind}-moments`} className="rounded-2xl border border-black/10 bg-white p-4">
      <h2 id={`${kind}-moments`} className="font-display text-base font-bold text-ink">Moments On This Page</h2>
      <p className="mt-1 text-xs text-ink/55">
        Public Moments connected to this {kind}. {canManage ? "Choose which ones show on its public page, and feature one to show it first. Hiding a Moment here never deletes it or changes where else it appears." : "Only an owner or manager can change what shows here."}
      </p>
      {moments.length === 0 ? (
        <p className="mt-3 text-sm text-ink/55">No public Moments are connected to this {kind} yet.</p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-black/[0.06]">
          {moments.map((m) => (
            <EntityMomentRow key={m.id} kind={kind} entityId={entityId} moment={m} canManage={canManage} />
          ))}
        </ul>
      )}
    </section>
  );
}
