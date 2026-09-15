import { TextField } from "@/components/admin/Fields";
import { getAdminQrCampaigns } from "@/lib/admin/qr-campaigns";
import { getPublicOrigin } from "@/lib/site-url";
import { createQrCampaign, setQrCampaignActive } from "./actions";

export const dynamic = "force-dynamic";

/** Founder QR campaign management — Phase 2B's own explicit scope: the
 * data/action foundation to safely create and test real campaigns, NOT
 * a polished dashboard (no scan counts/charts — that's a future
 * reporting pass reading analytics_events) and NOT QR image/download
 * generation (a campaign's public URL is shown as plain text; turning it
 * into a printable QR image is a deliberately separate later step). */
export default async function QrCampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const campaigns = await getAdminQrCampaigns();
  const origin = getPublicOrigin();

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">QR Campaigns</h1>
      <p className="mt-1 max-w-xl text-sm text-ink/50">
        Each campaign resolves at <code className="rounded bg-black/5 px-1 py-0.5">{origin}/q/&lt;code&gt;</code> and
        redirects to its destination, recording a qr_scan and — for a session&rsquo;s first scan — establishing that
        session&rsquo;s acquisition source. Print/encode the full URL wherever you need it; this page doesn&rsquo;t
        generate QR artwork.
      </p>

      {error && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          {saved === "created" ? "Campaign created — its scan URL is in the list below." : "Saved."}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-3">
        {campaigns.length === 0 ? (
          <p className="text-sm text-ink/45">No campaigns yet — create one below.</p>
        ) : (
          campaigns.map((c) => (
            <div key={c.id} className="rounded-2xl border border-black/10 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-sm font-semibold tracking-tight text-ink">{c.name}</p>
                  <p className="mt-0.5 break-all text-xs text-ink/50">
                    {origin}/q/{c.code}
                  </p>
                  <p className="mt-0.5 text-xs text-ink/45">
                    → {c.destination_path}
                    {c.placement && <> · {c.placement}</>}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                    c.is_active ? "bg-findmi-50 text-findmi-700" : "bg-black/5 text-ink/45"
                  }`}
                >
                  {c.is_active ? "Active" : "Inactive"}
                </span>
              </div>
              <form action={setQrCampaignActive.bind(null, c.id)} className="mt-3">
                {!c.is_active && <input type="hidden" name="is_active" value="on" />}
                <button type="submit" className="text-xs font-semibold text-findmi-700 hover:underline">
                  {c.is_active ? "Deactivate" : "Activate"}
                </button>
              </form>
            </div>
          ))
        )}
      </div>

      <div className="mt-8 rounded-2xl border border-dashed border-black/15 bg-black/[0.015] p-4">
        <p className="text-sm font-semibold text-ink">Create a campaign</p>
        <form action={createQrCampaign} className="mt-3 flex flex-col gap-3">
          <TextField label="Name" name="name" placeholder="e.g. EOS SoHo Sampling Table" required />
          <TextField
            label="Destination path"
            name="destination_path"
            placeholder="/business/eos"
            hint="Internal Findmi path only — no external URLs. Validated server-side."
            required
          />
          <TextField label="Placement (optional)" name="placement" placeholder="e.g. sampling_table, tent_sign, street_team" />
          <TextField label="Campaign label (optional)" name="campaign_label" />
          <p className="mt-1 text-xs font-bold uppercase tracking-wide text-ink/40">
            Attribution (optional — leave blank if not known)
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Business ID" name="business_id" placeholder="uuid" />
            <TextField label="Appearance ID" name="appearance_id" placeholder="uuid" />
            <TextField label="Event ID" name="event_id" placeholder="uuid" />
            <TextField label="Event Occurrence ID" name="event_occurrence_id" placeholder="uuid" />
            <TextField label="Location ID" name="location_id" placeholder="uuid" />
            <TextField label="Product ID" name="product_id" placeholder="uuid" />
          </div>
          <button
            type="submit"
            className="self-start rounded-full bg-ink px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-ink/85"
          >
            + Create Campaign
          </button>
        </form>
      </div>
    </div>
  );
}
