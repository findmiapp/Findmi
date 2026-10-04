import AdminSidebar from "@/components/admin/shell/AdminSidebar";
import AdminTopBar from "@/components/admin/shell/AdminTopBar";
import AdminMobileNav from "@/components/admin/shell/AdminMobileNav";
import AdminBreadcrumb from "@/components/admin/shell/AdminBreadcrumb";

/** Admin V2, Pass 1 — one shell for every protected admin page:
 *   desktop (lg+) — persistent AdminSidebar (sections + destinations,
 *                   Quick Create, utility links, Sign out);
 *   mobile/tablet — AdminTopBar (identity + context + Quick Create) and a
 *                   fixed AdminMobileNav bottom bar (Home · Directory ·
 *                   Activity · Requests · More).
 * AdminBreadcrumb adds "Section / Destination" (or a back-to-list control
 * on phones) above every detail/new/edit page. Route list:
 * components/admin/adminNavItems.ts. Pages themselves are unchanged. */
export default function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="lg:flex lg:min-h-screen">
      <AdminSidebar />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <AdminTopBar />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 lg:px-8 lg:pb-10 lg:pt-6">
          <AdminBreadcrumb />
          {children}
        </main>
      </div>
      <AdminMobileNav />
    </div>
  );
}
