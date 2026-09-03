import Link from "next/link";
import { TextField } from "@/components/admin/Fields";
import { createAdminUser } from "./actions";
import SetupMethodFields from "./SetupMethodFields";

export const dynamic = "force-dynamic";

export default async function NewAdminUserPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; existing_user_id?: string }>;
}) {
  const { error, existing_user_id } = await searchParams;

  return (
    <div className="mx-auto max-w-lg">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Create User</h1>
        <Link href="/admin/users" className="text-xs font-semibold text-ink/50 hover:text-ink">
          ← Back to Users
        </Link>
      </div>
      <p className="mt-1 text-sm text-ink/50">
        Creates a real FindMi account (Supabase Auth) for a consumer or vendor — not a founder admin login.
      </p>

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>{error}</p>
          {existing_user_id && (
            <Link href={`/admin/users/${existing_user_id}`} className="mt-1 inline-block font-semibold hover:underline">
              Manage that user →
            </Link>
          )}
        </div>
      )}

      <form action={createAdminUser} className="mt-5 flex flex-col gap-4 rounded-2xl border border-black/10 bg-white p-4">
        <TextField label="Display name" name="display_name" placeholder="Jane Doe" />
        <TextField label="Email" name="email" type="email" required placeholder="user@example.com" />
        <SetupMethodFields />

        <button
          type="submit"
          className="mt-1 w-full rounded-full bg-findmi px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Create User
        </button>
      </form>
    </div>
  );
}
