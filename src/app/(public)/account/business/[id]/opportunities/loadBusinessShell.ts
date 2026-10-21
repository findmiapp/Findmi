import "server-only";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { isAdminSession } from "@/lib/admin/auth";
import { getManagerCore, getManagerShellProps } from "../managerContext";

/** Same authorization + BusinessAppShell inputs the main
 * /account/business/[id] page uses (login bounce, requireBusinessMember,
 * account contexts, personal label, Pro state), for a sub-route that
 * renders its own copy of the shell. Both come from the shared manager
 * context (../managerContext), so the work is the same single pass. */
export async function loadBusinessShell(id: string, nextPath: string) {
  const user = await getCurrentUser();
  if (!user && !(await isAdminSession())) redirect(`/login?next=${encodeURIComponent(nextPath)}`);

  const [core, shell] = await Promise.all([getManagerCore(id), getManagerShellProps(id)]);
  return { membership: core.membership, shell };
}
