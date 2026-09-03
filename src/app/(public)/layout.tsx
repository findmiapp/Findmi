import NavDesktop from "@/components/NavDesktop";
import MobileHeader from "@/components/MobileHeader";
import AdminToolbar from "@/components/AdminToolbar";
import Footer from "@/components/Footer";
import { getVisibleNavItems } from "@/lib/navigation";
import { isAdminSession } from "@/lib/admin/auth";
import { getServerSupabase } from "@/lib/supabase/server";
import { getSiteContactInfo } from "@/lib/contact-info";

// Nav rarely changes — cache it site-wide for a minute rather than
// querying nav_items on every single page request (same revalidate
// precedent as the homepage's own site_sections/homepage_rows fetches).
export const revalidate = 60;

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  // One fetch, shared by both the mobile hamburger drawer and desktop nav
  // (Part A11/A5) — founder-managed nav_items when populated, otherwise
  // the real-routes-only fallback (see lib/navigation.ts).
  const navItems = await getVisibleNavItems();

  // Admin quick toolbar — AdminToolbar itself independently re-verifies
  // this (see its own note on why that's not a weaker check), but the
  // layout also needs to know up front whether it's about to render:
  // MobileHeader is `fixed top-0` on mobile, so on a real admin session
  // it has to shift down to make room for the toolbar sitting above it
  // (and the content wrapper's top padding grows to match), or the fixed
  // header would sit on top of / hide the toolbar instead of stacking
  // below it. Desktop's nav is `sticky`, not `fixed`, so it's already
  // pushed down naturally by the toolbar's own place in the document flow
  // there — no equivalent adjustment needed for it.
  const isAdmin = await isAdminSession();

  // Drawer utility strip data — resolved once, here, server-side (same
  // pattern as isAdmin/navItems above) rather than a client-side fetch in
  // HamburgerMenu, so there's no loading flash and no second, weaker auth
  // check: `authenticated` is the exact same /account Supabase session
  // check used everywhere else (see /api/account/me — this reads the same
  // session directly instead of round-tripping through that route from
  // inside a Server Component). contactInfo is the founder-editable
  // Admin → Site → Contact Info value (see lib/contact-info.ts) — a
  // missing/blank field resolves to null there, which the utility strip
  // reads as "hide this action."
  const {
    data: { user },
  } = await (await getServerSupabase()).auth.getUser();
  const authenticated = Boolean(user);
  const contactInfo = await getSiteContactInfo();

  return (
    <>
      <AdminToolbar />
      <MobileHeader
        navItems={navItems}
        adminToolbar={isAdmin}
        authenticated={authenticated}
        contactEmail={contactInfo.email}
        contactPhone={contactInfo.phone}
      />
      <NavDesktop navItems={navItems} />
      <div className={`flex-1 ${isAdmin ? "pt-[calc(3.5rem+1.75rem)]" : "pt-14"} md:pt-0`}>{children}</div>
      <Footer />
    </>
  );
}
