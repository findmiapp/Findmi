import NavDesktop from "@/components/NavDesktop";
import NavMobile from "@/components/NavMobile";
import MobileHeader from "@/components/MobileHeader";
import Footer from "@/components/Footer";
import { getVisibleNavItems } from "@/lib/navigation";

// Nav rarely changes — cache it site-wide for a minute rather than
// querying nav_items on every single page request (same revalidate
// precedent as the homepage's own site_sections/homepage_rows fetches).
export const revalidate = 60;

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  // One fetch, shared by both the mobile hamburger drawer and desktop nav
  // (Part A11/A5) — founder-managed nav_items when populated, otherwise
  // the real-routes-only fallback (see lib/navigation.ts).
  const navItems = await getVisibleNavItems();

  return (
    <>
      <MobileHeader navItems={navItems} />
      <NavDesktop navItems={navItems} />
      {/* No bottom padding here: Footer (always the next element) carries
          its own nav-clearance padding, so double-padding this div only
          produced a dead gap between content and the footer. */}
      <div className="flex-1 pt-14 md:pt-0">{children}</div>
      <Footer />
      <NavMobile />
    </>
  );
}
