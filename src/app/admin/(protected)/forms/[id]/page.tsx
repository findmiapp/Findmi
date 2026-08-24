import { notFound } from "next/navigation";
import { getAdminFormById, getAssignmentsForForm } from "@/lib/admin/form-queries";
import { FORM_PURPOSE_LABELS } from "@/lib/forms";
import DeleteButton from "@/components/admin/DeleteButton";
import FormDefinitionForm from "../FormDefinitionForm";
import AddAssignmentForm from "./AddAssignmentForm";
import { addAssignment, deleteForm, removeAssignment } from "../actions";

export const dynamic = "force-dynamic";

export default async function EditFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { error, saved } = await searchParams;
  const [form, assignments] = await Promise.all([getAdminFormById(id), getAssignmentsForForm(id)]);
  if (!form) notFound();

  const addAssignmentAction = addAssignment.bind(null, id);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Edit Form</h1>
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">Saved.</p>
      )}
      <div className="mt-5">
        <FormDefinitionForm form={form} error={error} />
      </div>

      <div className="mt-8 border-t border-black/5 pt-6">
        <p className="text-sm font-semibold text-ink">
          Assignments <span className="text-ink/40">({assignments.length})</span>
        </p>
        <p className="mt-1 text-xs text-ink/50">
          A specific business/event/product assignment overrides the global default for that
          purpose. This form&rsquo;s own default status above is unaffected.
        </p>

        {assignments.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {assignments.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-black/10 bg-white px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{a.entityLabel}</p>
                  <p className="text-xs text-ink/45">
                    {a.entity_type} · {FORM_PURPOSE_LABELS[a.purpose]}
                  </p>
                </div>
                <form action={removeAssignment.bind(null, id, a.id)}>
                  <button type="submit" className="shrink-0 text-xs font-semibold text-red-600 hover:underline">
                    Remove
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4">
          <AddAssignmentForm formPurpose={form.purpose} action={addAssignmentAction} />
        </div>
      </div>

      <div className="mt-8 border-t border-black/5 pt-5">
        <DeleteButton
          action={deleteForm.bind(null, form.id)}
          confirmMessage={`Delete "${form.name}"? Its assignments are removed too. This can't be undone.`}
        />
      </div>
    </div>
  );
}
