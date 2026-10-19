import Link from "next/link";
import type { EventManagement, LocationManagement, ManagerRow } from "@/lib/admin/entity-management";
import { EVENT_UNCHANGED } from "@/lib/admin/ownership-plan";
import { ConfirmSubmitButton, EventReassignForm } from "./OwnershipControls";
import { addEventManager, addLocationManager, reassignEventManagingPage, removeEventManager, removeLocationManager, reviewLocationSubmission } from "./actions";

// Admin Ownership & Management — the same control surface for every
// manageable entity, over each one's own tables (lib/admin/entity-
// management.ts). Every change asks first (ConfirmSubmitButton /
// EventReassignForm).

const ROLE_LABEL = { owner: "Owner", manager: "Manager", staff: "Staff" } as const;
const userLabel = (m: { displayName: string | null; email: string | null }) => m.displayName || m.email || "Findmi account";
const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });

function Shell({ notice, error, children }: { notice?: string | null; error?: string | null; children: React.ReactNode }) {
  return (
    <section id="ownership" aria-labelledby="ownership-title" className="mt-3 flex flex-col gap-4 rounded-xl border border-black/10 bg-white px-4 py-4">
      <h2 id="ownership-title" className="text-sm font-semibold text-ink">
        Ownership &amp; Management
      </h2>
      {notice && <p className="rounded-lg border border-findmi/30 bg-findmi-50 px-3 py-2 text-sm text-findmi-700">{notice}</p>}
      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {children}
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-bold uppercase tracking-wide text-ink/45">{children}</p>;
}

function ManagerList({ managers, empty, remove, entityLabel }: { managers: ManagerRow[]; empty: string; remove: (memberId: string) => (formData: FormData) => void | Promise<void>; entityLabel: string }) {
  if (managers.length === 0) return <p className="text-sm text-ink/55">{empty}</p>;
  return (
    <ul className="divide-y divide-black/[0.06]">
      {managers.map((m) => (
        <li key={m.memberId} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">
              <Link href={`/admin/users/${m.userId}`} className="hover:underline">
                {userLabel(m)}
              </Link>
            </p>
            <p className="truncate text-xs text-ink/50">
              {ROLE_LABEL[m.role]}
              {m.email && m.displayName ? ` · ${m.email}` : ""} · since {date(m.since)}
            </p>
          </div>
          <form action={remove(m.memberId)}>
            <ConfirmSubmitButton
              label="Remove"
              tone="danger"
              title={`Remove ${userLabel(m)}?`}
              message={`${userLabel(m)} will no longer manage ${entityLabel}. Nothing else about it changes.`}
              confirmLabel="Remove Access"
            />
          </form>
        </li>
      ))}
    </ul>
  );
}

function AddManagerForm({ action }: { action: (formData: FormData) => void | Promise<void> }) {
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="min-w-0 flex-1">
        <span className="mb-1 block text-xs font-medium text-ink/60">Add Manager (Findmi account email)</span>
        <input type="email" name="email" required autoCapitalize="none" autoComplete="off" className="w-full rounded-lg border border-black/10 px-3 py-1.5 text-sm" />
      </label>
      <button type="submit" className="rounded-lg border border-black/15 px-3 py-1.5 text-sm font-semibold text-ink hover:border-black/30">
        Add Manager
      </button>
    </form>
  );
}

const EVENT_NOTICE: Record<string, string> = {
  reassigned: "Managing Page updated. Nothing else about the Event changed.",
  manager_removed: "Manager removed.",
  manager_added: "Manager added.",
};

export function EventOwnershipPanel({
  eventId,
  eventName,
  management,
  notice,
  error,
}: {
  eventId: string;
  eventName: string;
  management: EventManagement;
  notice?: string | null;
  error?: string | null;
}) {
  const { managingPage, directManagers, participants, pendingRequests } = management;
  return (
    <Shell notice={notice ? (EVENT_NOTICE[notice] ?? null) : null} error={error}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label>Managing Page</Label>
          {managingPage ? (
            <p className="text-sm text-ink">
              <Link href={`/admin/businesses/${managingPage.id}?tab=ownership`} className="font-semibold hover:underline">
                {managingPage.name}
              </Link>{" "}
              <span className="text-ink/55">
                · {managingPage.managerCount} Owner/Manager{managingPage.managerCount === 1 ? "" : "s"} can edit
              </span>
            </p>
          ) : (
            <p className="text-sm text-ink/55">None — this Event isn&rsquo;t published through a Page.</p>
          )}
          {managingPage && managingPage.managerCount === 0 && (
            <p className="text-xs text-amber-700">{managingPage.name} has no Owner or Manager yet, so only Admin can edit through it.</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label>Participating Businesses (not management)</Label>
          <p className="text-sm text-ink/70">{participants.length ? participants.map((p) => `${p.name}${p.status && p.status !== "approved" ? ` (${p.status})` : ""}`).join(", ") : "None"}</p>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label>Direct Managers (user accounts)</Label>
        <ManagerList
          managers={directManagers}
          empty="No direct managers."
          entityLabel={eventName}
          remove={(memberId) => removeEventManager.bind(null, eventId, memberId)}
        />
      </div>

      {pendingRequests.length > 0 && (
        <div className="flex flex-col gap-1">
          <Label>Pending Management Requests</Label>
          {pendingRequests.map((r) => (
            <p key={r.claimId} className="text-sm text-ink/75">
              {r.fullName || r.email || "Findmi account"} · {date(r.createdAt)} —{" "}
              <Link href="/admin/claims" className="font-semibold text-findmi-700 hover:underline">
                Review In Claims
              </Link>
            </p>
          ))}
        </div>
      )}

      <div className="border-t border-black/[0.06] pt-3">
        <EventReassignForm
          action={reassignEventManagingPage.bind(null, eventId)}
          eventName={eventName}
          currentHost={managingPage ? { id: managingPage.id, name: managingPage.name } : null}
          directManagers={directManagers.map((m) => ({ memberId: m.memberId, label: userLabel(m) }))}
        />
        <p className="mt-2 text-xs text-ink/45">{EVENT_UNCHANGED}</p>
      </div>
      <AddManagerForm action={addEventManager.bind(null, eventId)} />
    </Shell>
  );
}

const LOCATION_NOTICE: Record<string, string> = {
  approve_assign: "Location approved and the requester now manages it.",
  approve_unclaimed: "Location approved and left unclaimed.",
  decline_request: "Management request declined. The Location itself is unchanged.",
  publish: "Location approved.",
  manager_removed: "Manager removed.",
  manager_added: "Manager added.",
};

export function LocationOwnershipPanel({
  locationId,
  locationName,
  isPending,
  management,
  notice,
  error,
}: {
  locationId: string;
  locationName: string;
  isPending: boolean;
  management: LocationManagement;
  notice?: string | null;
  error?: string | null;
}) {
  const { managers, pendingRequests, parent, businesses } = management;
  const request = pendingRequests[0] ?? null;
  const review = reviewLocationSubmission.bind(null, locationId);
  const decision = (value: string, label: string, title: string, message: string, tone: "primary" | "neutral" | "danger") => (
    <form action={review}>
      <input type="hidden" name="decision" value={value} />
      {request && <input type="hidden" name="claim_id" value={request.claimId} />}
      <ConfirmSubmitButton label={label} title={title} message={message} confirmLabel={label} tone={tone} />
    </form>
  );
  return (
    <Shell notice={notice ? (LOCATION_NOTICE[notice] ?? null) : null} error={error}>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label>Listing</Label>
          <p className="text-sm text-ink">{isPending ? "Pending review — not public" : "Approved"}</p>
        </div>
        <div className="flex flex-col gap-1">
          <Label>Claim Status</Label>
          <p className="text-sm text-ink">{managers.length ? `Managed (${managers.length})` : request ? "Management requested" : "Unclaimed"}</p>
        </div>
        <div className="flex flex-col gap-1">
          <Label>Inside (hierarchy only)</Label>
          <p className="text-sm text-ink/70">{parent ? parent.name : "—"}</p>
          {businesses.length > 0 && <p className="text-xs text-ink/50">Connected Businesses: {businesses.map((b) => b.name).join(", ")}</p>}
        </div>
      </div>

      {request && (
        <div className="flex flex-col gap-2 rounded-lg bg-black/[0.025] px-3 py-3">
          <Label>Management Request</Label>
          <p className="text-sm text-ink">
            <Link href={`/admin/users/${request.userId}`} className="font-semibold hover:underline">
              {request.fullName || request.email || "Findmi account"}
            </Link>
            {request.email && request.fullName ? ` · ${request.email}` : ""} · {date(request.createdAt)}
          </p>
          <p className="text-sm text-ink/70">Chose: &ldquo;I Manage This Location.&rdquo; {request.message ? `— ${request.message}` : ""}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {request
          ? [
              decision("approve_assign", "Approve + Assign To Requester", `Approve ${locationName} and assign it?`, `${locationName} will be approved on Findmi and ${request.fullName || request.email || "the requester"} will become its Owner. Its hierarchy, connected Businesses and other details don't change.`, "primary"),
              decision("approve_unclaimed", "Approve + Leave Unclaimed", `Approve ${locationName} without assigning it?`, `${locationName} will be approved on Findmi and stay unclaimed. The management request will be declined. Nothing else changes.`, "neutral"),
              decision("decline_request", "Decline Request", "Decline this management request?", `The request to manage ${locationName} will be declined. The Location itself is not changed or removed.`, "danger"),
            ]
          : isPending
            ? decision("publish", "Approve Location", `Approve ${locationName}?`, `${locationName} will be approved on Findmi. Its management (currently ${managers.length ? "assigned" : "unclaimed"}) doesn't change.`, "primary")
            : null}
      </div>

      <div className="flex flex-col gap-1">
        <Label>Managers</Label>
        <ManagerList managers={managers} empty="Unclaimed — nobody manages this Location." entityLabel={locationName} remove={(memberId) => removeLocationManager.bind(null, locationId, memberId)} />
      </div>
      <AddManagerForm action={addLocationManager.bind(null, locationId)} />
      <p className="text-xs text-ink/45">Merging duplicates and requesting more information aren&rsquo;t available yet.</p>
    </Shell>
  );
}
