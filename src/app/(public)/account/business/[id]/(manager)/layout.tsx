import type { ReactNode } from "react";
import BusinessAppShell from "../v2/BusinessAppShell";
import { getManagerShellProps } from "../managerContext";

/** Business Manager — the persistent shell. Business identity, the account
 * switcher and the primary navigation live here, above the page, so
 * switching between Home / Moments / Findmi Here / Performance / More only
 * re-renders the CONTENT view: Next keeps this layout (and its client
 * navigation) mounted and does not re-render it on the server when just the
 * `?tab=` of the page changes. Its data comes from the shared manager context
 * (../managerContext), the same per-request-cached reads the page uses. */
export default async function ManagerLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const shell = await getManagerShellProps(id);
  return <BusinessAppShell {...shell}>{children}</BusinessAppShell>;
}
