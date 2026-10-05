import Link from "next/link";
import AccountContextSwitcher, { type SwitcherCurrent } from "@/components/account/AccountContextSwitcher";
import type { AccountBusinessContext } from "@/lib/accountContext";

/** Account Shell V1 — Event + Location Manager pass. Replaces the old
 * <AccountNav /> (a full Home/Schedule/Business/Inbox grid + Create menu
 * + Saved/Following/Orders/Profile + Sign Out) that used to sit at the
 * top of both the Event and Location Managers — a page about "managing
 * this Event/Location" has no real use for any of that, and it created
 * the exact V1/V2 chrome discontinuity this pass retires.
 *
 * What an Entity Manager genuinely still needs beyond its own body:
 *   - Findmi brand identity — already provided globally by OwnerHeader
 *     on every /account/* route, so this component doesn't repeat it.
 *   - Global Account Context Switcher V1 — Event/Location are NOT account
 *     contexts (see CLAUDE.md's architecture model), so this is the one
 *     place a Manager page exposes Personal/Business switching and the
 *     app's only reachable Sign Out for these two pages (previously a
 *     real gap: an Entity Manager had no sign-out at all). `current` is
 *     derived by the caller from the SAME already-resolved
 *     `businessContext` (the `?business_id=` hint via
 *     resolveBusinessNavContext) the back-link below already uses — a
 *     navigation hint, never new inference.
 *   - A way BACK — `backHref`/`backLabel`, resolved by the caller from an
 *     explicit `?business_id=` navigation hint (never guessed/inferred —
 *     see lib/permissions.ts's own resolveBusinessNavContext) when one
 *     resolved, or a neutral `/account` fallback otherwise. This is
 *     presentation only: it never implies the linked Business owns this
 *     Event/Location.
 *   - The admin-elevated notice, identical in shape on both Managers
 *     before this pass (just the entity name and exit href differed) —
 *     consolidated here rather than kept as two near-identical blocks. */
export default function EntityManagerContextBar({
  backHref,
  backLabel,
  isAdminElevated,
  adminExitHref,
  entityName,
  current,
  personalLabel,
  businesses,
}: {
  backHref: string;
  backLabel: string;
  isAdminElevated: boolean;
  adminExitHref: string;
  entityName: string;
  current: SwitcherCurrent;
  personalLabel: string;
  businesses: AccountBusinessContext[];
}) {
  return (
    <>
      <div className="mb-3 flex justify-end">
        <AccountContextSwitcher current={current} personalLabel={personalLabel} businesses={businesses} />
      </div>

      <Link href={backHref} className="mb-3 inline-flex items-center text-metadata font-semibold text-muted hover:text-primary">
        &larr; {backLabel}
      </Link>

      {isAdminElevated && (
        <div className="mx-auto mb-4 max-w-md rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-body font-bold text-amber-800">Admin mode: you are managing {entityName} with elevated access.</p>
          <Link
            href={adminExitHref}
            className="mt-1.5 inline-block text-metadata font-semibold text-amber-800 underline underline-offset-2 hover:text-amber-900"
          >
            Exit Admin Mode
          </Link>
        </div>
      )}
    </>
  );
}
