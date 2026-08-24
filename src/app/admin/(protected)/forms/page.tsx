import Link from "next/link";
import { getAdminForms } from "@/lib/admin/form-queries";
import { FORM_PURPOSE_LABELS, FORM_PURPOSES } from "@/lib/forms";
import type { FormPurpose } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminFormsPage({
  searchParams,
}: {
  searchParams: Promise<{ purpose?: string }>;
}) {
  const { purpose } = await searchParams;
  const validPurpose = FORM_PURPOSES.includes(purpose as FormPurpose) ? (purpose as FormPurpose) : undefined;
  const forms = await getAdminForms({ purpose: validPurpose });

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Forms</h1>
        <Link
          href="/admin/forms/new"
          className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink hover:bg-findmi-600"
        >
          New Form
        </Link>
      </div>
      <p className="mt-1 text-sm text-ink/50">
        Which Tally forms FindMi uses for onboarding, inquiries, RSVP, and vendor applications —
        without a code change.
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        <Link
          href="/admin/forms"
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
            !validPurpose ? "bg-ink text-white" : "bg-black/[0.04] text-ink/60 hover:bg-black/[0.08]"
          }`}
        >
          All
        </Link>
        {FORM_PURPOSES.map((p) => (
          <Link
            key={p}
            href={`/admin/forms?purpose=${p}`}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              validPurpose === p ? "bg-ink text-white" : "bg-black/[0.04] text-ink/60 hover:bg-black/[0.08]"
            }`}
          >
            {FORM_PURPOSE_LABELS[p]}
          </Link>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {forms.length === 0 ? (
          <p className="text-sm text-ink/50">
            No forms yet — create one, or FindMi keeps using the existing environment-variable
            forms in the meantime.
          </p>
        ) : (
          forms.map((f) => (
            <Link
              key={f.id}
              href={`/admin/forms/${f.id}`}
              className="flex flex-col gap-1.5 rounded-xl border border-black/5 bg-white px-4 py-3 transition hover:border-black/10"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-semibold text-ink">{f.name}</p>
                <span className="shrink-0 text-[11px] text-ink/40">
                  {f.assignmentCount} assignment{f.assignmentCount === 1 ? "" : "s"}
                </span>
              </div>
              <p className="text-xs text-ink/50">
                {FORM_PURPOSE_LABELS[f.purpose]} · Tally · {f.display_mode === "embed" ? "Embed" : "External"}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={f.is_active ? "live" : "default"}>{f.is_active ? "Active" : "Inactive"}</Badge>
                {f.is_default && <Badge tone="live">Default</Badge>}
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

function Badge({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "live" }) {
  const cls = tone === "live" ? "bg-findmi-50 text-findmi-700" : "bg-black/[0.06] text-ink/60";
  return <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${cls}`}>{children}</span>;
}
