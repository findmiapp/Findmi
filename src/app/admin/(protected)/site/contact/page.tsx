import { TextField } from "@/components/admin/Fields";
import { getAdminSiteSections } from "@/lib/admin/site-queries";
import { saveContactInfo } from "./actions";

export const dynamic = "force-dynamic";

const PAGE_KEY = "global";
const SECTION_KEY = "contact";

export default async function ContactInfoSiteEditorPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const overrides = await getAdminSiteSections(PAGE_KEY);
  const row = overrides.get(SECTION_KEY);
  const config = (row?.config_json ?? {}) as { email?: string; phone?: string };

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Contact Info</h1>
      <p className="mt-1 text-sm text-ink/50">
        The public email and phone number shown as quick actions in the mobile menu. Leave either blank to
        hide that action on the public site — never shown as a dead link.
      </p>
      {error && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Saved.
        </p>
      )}

      <form
        action={saveContactInfo}
        className="mt-5 flex flex-col gap-3 rounded-2xl border border-black/10 bg-white p-4"
      >
        <TextField
          label="Public email"
          name="email"
          type="email"
          defaultValue={config.email ?? ""}
          placeholder="hello@findmi.app"
          hint="Opens the visitor's email app via a mailto: link. Leave blank to hide this action."
        />
        <TextField
          label="Public phone"
          name="phone"
          type="tel"
          defaultValue={config.phone ?? ""}
          placeholder="+1 555 123 4567"
          hint="Opens the visitor's phone app via a tel: link. Leave blank to hide this action."
        />
        <button
          type="submit"
          className="self-start rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Save
        </button>
      </form>
    </div>
  );
}
