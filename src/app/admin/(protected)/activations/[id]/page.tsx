import Link from "next/link";
import { notFound } from "next/navigation";
import AdminTabNav, { type TabNavItem } from "@/components/admin/TabNav";
import { NumberField, TextField, TextareaField, SelectField, CheckboxField } from "@/components/admin/Fields";
import ImageField from "@/components/admin/ImageField";
import SubmitBar from "@/components/admin/SubmitBar";
import {
  getAdminActivationById,
  getAdminActivationInventory,
  getAdminActivationOptions,
  getAdminActivationVenues,
} from "@/lib/admin/activations";
import { saveActivationOverview, saveActivationPublicPage, saveActivationSettings } from "../actions";
import ActivationVenuesTab from "./ActivationVenuesTab";
import ActivationBuilderConfigTab from "./ActivationBuilderConfigTab";

export const dynamic = "force-dynamic";

// Pass 1 — only the tabs needed for the four foundational objects
// (activations/activation_venues/activation_options/activation_inventory).
// A Requests tab is deliberately NOT here — activation_requests doesn't
// exist until Pass 2 (see the frozen architecture amendment).
const ADMIN_TABS: TabNavItem[] = [
  { key: "overview", label: "Overview" },
  { key: "venues", label: "Venues" },
  { key: "builder-config", label: "Builder Config" },
  { key: "public-page", label: "Public Page" },
  { key: "settings", label: "Settings" },
];
const ADMIN_TAB_KEYS = new Set(ADMIN_TABS.map((t) => t.key));

const PHASE_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "exploring", label: "Exploring" },
  { value: "applications_open", label: "Applications Open" },
  { value: "confirmed", label: "Confirmed" },
  { value: "live", label: "Live" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
];

const PRICE_VISIBILITY_OPTIONS = [
  { value: "visible", label: "Visible — show the real price" },
  { value: "hidden", label: "Hidden — no price shown" },
  { value: "custom_label", label: "Custom Label — show price_label text only" },
];

export default async function EditActivationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { tab: tabParam, error, saved } = await searchParams;
  const tab = tabParam && ADMIN_TAB_KEYS.has(tabParam) ? tabParam : "overview";

  const activation = await getAdminActivationById(id);
  if (!activation) notFound();

  const [venues, options, inventory] = await Promise.all([
    getAdminActivationVenues(id),
    getAdminActivationOptions(id),
    getAdminActivationInventory(id),
  ]);

  const basePath = `/admin/activations/${id}`;
  const publicHref = activation.is_published ? `/activations/${activation.slug}` : null;

  const saveOverview = saveActivationOverview.bind(null, id);
  const saveSettings = saveActivationSettings.bind(null, id);
  const savePublicPage = saveActivationPublicPage.bind(null, id);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-label font-bold uppercase text-accent">Activation</p>
          <h1 className="font-display text-page-title font-bold text-primary">{activation.public_name || activation.internal_name}</h1>
        </div>
        {publicHref && (
          <Link
            href={publicHref}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-black/10 px-3.5 py-2 text-metadata font-semibold text-muted transition hover:border-black/20 hover:text-primary"
          >
            View Public Page ↗
          </Link>
        )}
      </div>

      {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-body text-red-700">{error}</p>}
      {saved && !error && <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-body text-accent">Saved.</p>}

      <div className="mt-5">
        <AdminTabNav items={ADMIN_TABS} activeKey={tab} basePath={basePath} />
      </div>

      <div className="mt-5">
        {tab === "overview" && (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-black/5 bg-white p-3.5">
                <p className="font-display text-stat font-bold text-primary tabular-nums">{venues.length}</p>
                <p className="mt-0.5 text-label font-bold uppercase text-subtle">Venues</p>
              </div>
              <div className="rounded-2xl border border-black/5 bg-white p-3.5">
                <p className="font-display text-stat font-bold text-primary tabular-nums">
                  {options.filter((o) => o.kind === "goal").length}
                </p>
                <p className="mt-0.5 text-label font-bold uppercase text-subtle">Goals</p>
              </div>
              <div className="rounded-2xl border border-black/5 bg-white p-3.5">
                <p className="font-display text-stat font-bold text-primary tabular-nums">
                  {options.filter((o) => o.kind === "family").length}
                </p>
                <p className="mt-0.5 text-label font-bold uppercase text-subtle">Families</p>
              </div>
              <div className="rounded-2xl border border-black/5 bg-white p-3.5">
                <p className="font-display text-stat font-bold text-primary tabular-nums">{inventory.length}</p>
                <p className="mt-0.5 text-label font-bold uppercase text-subtle">Inventory Items</p>
              </div>
            </div>

            <div className="rounded-2xl border border-black/5 bg-white p-3.5">
              <p className="text-label font-bold uppercase text-subtle">Publish State</p>
              <p className="mt-1.5 text-body text-primary">
                {activation.is_published ? "Published" : "Unpublished"} — manage in Settings.
              </p>
              {venues.some((v) => v.start_at) && (
                <p className="mt-1 text-metadata text-muted">
                  Operating window (from Venues):{" "}
                  {new Date(
                    Math.min(...venues.filter((v) => v.start_at).map((v) => new Date(v.start_at!).getTime()))
                  ).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  {" – "}
                  {new Date(
                    Math.max(...venues.filter((v) => v.end_at).map((v) => new Date(v.end_at!).getTime()))
                  ).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </p>
              )}
            </div>

            <form action={saveOverview} className="flex flex-col gap-4 rounded-2xl border border-black/5 bg-white p-3.5 sm:p-5">
              <p className="text-section-title font-semibold text-primary">Phase &amp; Planning Targets</p>
              <SelectField label="Phase" name="phase" defaultValue={activation.phase} options={PHASE_OPTIONS} />
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField label="Target Revenue" name="target_revenue" defaultValue={activation.target_revenue} />
                <NumberField
                  label="Minimum Committed Threshold"
                  name="minimum_committed_threshold"
                  defaultValue={activation.minimum_committed_threshold}
                />
                <NumberField label="Target Brand Count" name="target_brand_count" defaultValue={activation.target_brand_count} step="1" />
                <NumberField label="Anchor Partner Target" name="anchor_partner_target" defaultValue={activation.anchor_partner_target} step="1" />
                <NumberField label="Venue Budget Ceiling" name="venue_budget_ceiling" defaultValue={activation.venue_budget_ceiling} />
                <NumberField
                  label="Production Budget Ceiling"
                  name="production_budget_ceiling"
                  defaultValue={activation.production_budget_ceiling}
                />
              </div>
              <TextField label="Decision Deadline" name="decision_deadline" type="date" defaultValue={activation.decision_deadline} />
              <SubmitBar cancelHref={basePath} />
            </form>
          </div>
        )}

        {tab === "venues" && <ActivationVenuesTab activationId={id} venues={venues} />}

        {tab === "builder-config" && (
          <ActivationBuilderConfigTab activationId={id} venues={venues} options={options} inventory={inventory} />
        )}

        {tab === "public-page" && (
          <form action={savePublicPage} className="flex flex-col gap-4 rounded-2xl border border-black/5 bg-white p-3.5 sm:p-5">
            <p className="text-section-title font-semibold text-primary">Public-Facing Content</p>
            <p className="text-metadata text-subtle">
              Manages the data the future public /activations page will consume — this does not publish that page.
            </p>
            <TextField label="Public Name" name="public_name" defaultValue={activation.public_name} required />
            <TextField label="Concept Label" name="concept_label" defaultValue={activation.concept_label} />
            <TextareaField label="Short Description" name="short_description" defaultValue={activation.short_description} rows={2} />
            <TextareaField label="Description" name="description" defaultValue={activation.description} rows={6} />
            <ImageField label="Cover Image" name="cover_image_url" defaultValue={activation.cover_image_url} />

            <div className="border-t border-black/5 pt-4">
              <p className="text-section-title font-semibold text-primary">SEO</p>
              <div className="mt-3 flex flex-col gap-4">
                <TextField label="Meta Title" name="meta_title" defaultValue={activation.meta_title} />
                <TextareaField label="Meta Description" name="meta_description" defaultValue={activation.meta_description} rows={2} />
                <ImageField label="Social Share Image" name="og_image_url" defaultValue={activation.og_image_url} />
              </div>
            </div>
            <SubmitBar cancelHref={basePath} />
          </form>
        )}

        {tab === "settings" && (
          <form action={saveSettings} className="flex flex-col gap-4 rounded-2xl border border-black/5 bg-white p-3.5 sm:p-5">
            <TextField label="URL Slug" name="slug" defaultValue={activation.slug} required hint="Used in /activations/[slug] once the public page exists." />

            <div className="grid gap-4 sm:grid-cols-3">
              <TextField label="City" name="city" defaultValue={activation.city} />
              <TextField label="Region" name="region" defaultValue={activation.region} />
              <TextField label="Country Code" name="country_code" defaultValue={activation.country_code} hint="ISO 3166-1 alpha-2" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Default Timezone" name="default_timezone" defaultValue={activation.default_timezone} hint="IANA timezone" />
              <TextField label="Currency" name="currency_code" defaultValue={activation.currency_code} hint="ISO 4217" />
            </div>

            <SelectField
              label="Default Price Visibility"
              name="default_price_visibility"
              defaultValue={activation.default_price_visibility}
              options={PRICE_VISIBILITY_OPTIONS}
              hint="Individual inventory items may override this — see Builder Config."
            />

            <div className="border-t border-black/5 pt-4">
              <p className="text-section-title font-semibold text-primary">Publication</p>
              <div className="mt-3 flex flex-col gap-4">
                <CheckboxField
                  label="Published"
                  name="is_published"
                  defaultChecked={activation.is_published}
                  hint="Makes this Activation's published columns publicly readable once a public page exists."
                />
                <TextField label="Publish At" name="publish_at" type="date" defaultValue={activation.publish_at} hint="Optional embargo date." />
              </div>
            </div>

            <SubmitBar cancelHref={basePath} />
          </form>
        )}
      </div>
    </div>
  );
}
