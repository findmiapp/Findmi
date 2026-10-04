import type { Metadata } from "next";
import Link from "next/link";
import SignOutConfirm from "@/components/SignOutConfirm";
import AdminSectionHub from "@/components/admin/shell/AdminSectionHub";
import { logout } from "../../login/actions";

export const metadata: Metadata = { title: "More" };

/** Admin V2 — More: secondary operational/configuration tools, plus the
 * utility links the desktop rail keeps at its foot (public site, your
 * account, sign out). */
export default function AdminMorePage() {
  return (
    <AdminSectionHub
      section="more"
      footer={
        <section aria-label="Findmi">
          <h2 className="mb-2 px-1 text-label font-bold uppercase text-subtle">Findmi</h2>
          <div className="divide-y divide-black/[0.06] overflow-hidden rounded-2xl border border-black/[0.07] bg-white">
            <Link href="/" className="flex min-h-[52px] items-center px-4 text-card-title font-semibold text-primary transition hover:bg-black/[0.02]">
              View Findmi
            </Link>
            <Link href="/account" className="flex min-h-[52px] items-center px-4 text-card-title font-semibold text-primary transition hover:bg-black/[0.02]">
              Your account
            </Link>
            <SignOutConfirm
              action={logout}
              className="flex min-h-[52px] w-full items-center px-4 text-left text-card-title font-semibold text-red-600 transition hover:bg-red-50"
            >
              Sign out
            </SignOutConfirm>
          </div>
        </section>
      }
    />
  );
}
