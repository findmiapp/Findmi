import { isAdminSession } from "@/lib/admin/auth";
import AdminToolbarBar from "./AdminToolbarBar";

// Founder-only black Admin toolbar — rendered on public Findmi, inside
// /admin and inside /account whenever the real Admin session is present.
// isAdminSession() reads the same signed httpOnly cookie every /admin
// route and Server Action relies on (src/lib/admin/auth.ts), never a
// client flag; anyone else gets null.
//
// placement:
//   "public" — fixed on mobile (above the fixed MobileHeader), static on
//              desktop. Its presence sets --admin-bar-h (globals.css), the
//              ONE token every toolbar-aware offset reads.
//   "static" — in normal flow (inside /admin, /account and the auth
//              screens, whose own headers are sticky).
export default async function AdminToolbar({ placement = "public" }: { placement?: "public" | "static" }) {
  if (!(await isAdminSession())) return null;
  return <AdminToolbarBar placement={placement} />;
}
