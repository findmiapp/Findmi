import NavDesktop from "@/components/NavDesktop";
import MobileHeader from "@/components/MobileHeader";
import AdminToolbar from "@/components/AdminToolbar";
import Footer from "@/components/Footer";
import SiteChrome from "@/components/SiteChrome";
import { BusinessesProvider } from "@/components/BusinessesContext";
import { isAdminSession } from "@/lib/admin/auth";
import { getServerSupabase } from "@/lib/supabase/server";
import { filterNavItemsForAudience, getVisibleNavItems, publicDiscoveryNav } from "@/lib/navigation";
import type { BusinessOption } from "@/app/(public)/account/BusinessScopedAction";
import { getAccountContexts } from "@/lib/accountContext";
import { getSite } from "@/lib/site";

// Nav rarely changes — cache it site-wide for a minute rather than
// querying nav_items on every single page request (same revalidate
// precedent as the homepage's own site_sections/homepage_rows fetches).
export const revalidate = 60;

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  // A site without accounts (lib/site.ts — JerseyCity.guide) uses its own
  // configured nav and never resolves a session, admin cookie or managed
  // businesses; its headers then show discovery only.
  const site = getSite();
  if (!site.features.accounts) {
    const siteNav = publicDiscoveryNav(site.nav ?? (await getVisibleNavItems()));
    return (
      <SiteChrome
        adminToolbar={null}
        adminToolbarStatic={null}
        mobileHeader={<MobileHeader navItems={siteNav} authenticated={false} isAdmin={false} businesses={[]} />}
        navDesktop={<NavDesktop navItems={siteNav} authenticated={false} isAdmin={false} businesses={[]} />}
        footer={<Footer />}
      >
        <BusinessesProvider businesses={[]}>{children}</BusinessesProvider>
      </SiteChrome>
    );
  }

  // Public DISCOVERY navigation — founder-managed nav_items (Admin → Site
  // → Navigation), one fetch shared by the desktop bar and the drawer,
  // falling back to the approved default IA when the table is empty.
  // Account, auth, Cart and Admin controls stay code-owned; rows pointing
  // at those reserved destinations are left out (publicDiscoveryNav).
  const allNavItems = await getVisibleNavItems();

  // Admin session — the drawer/account menu's Admin entry. The toolbar's
  // own offsets come from --admin-bar-h (globals.css), not this flag.
  const isAdmin = await isAdminSession();

  // `authenticated` is the exact same /account Supabase session check used
  // everywhere else (see /api/account/me — this reads the same session
  // directly instead of round-tripping through that route from inside a
  // Server Component).
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const authenticated = Boolean(user);

  // Global Quick-Create pass — the same managed-Business list
  // BusinessScopedAction needs for its zero/one/many routing decision
  // (see /account/page.tsx's identical query), fetched once here so both
  // the mobile and desktop headers' QuickCreateMenu share it without a
  // second round trip each. Empty/unfetched whenever signed out — a
  // signed-out visitor's business-scoped quick-create actions route
  // through login instead (see QuickCreateMenu), never through this list.
  // Global Account Context Switcher V1 — the same shared helper the new
  // switcher uses, now feeding BusinessesProvider too, so every consumer
  // of useBusinesses() (QuickCreateMenu, NavDesktop, MobileHeader, the
  // Personal/Business account shells) gets slug/logoUrl/role for free
  // from the ONE query already made here, no second round trip.
  const navItems = publicDiscoveryNav(filterNavItemsForAudience(allNavItems, authenticated));

  let businesses: BusinessOption[] = [];
  if (authenticated) {
    businesses = await getAccountContexts(supabase, user!.id);
  }

  return (
    <SiteChrome
      adminToolbar={<AdminToolbar />}
      adminToolbarStatic={<AdminToolbar placement="static" />}
      mobileHeader={<MobileHeader navItems={navItems} authenticated={authenticated} isAdmin={isAdmin} businesses={businesses} />}
      navDesktop={<NavDesktop navItems={navItems} authenticated={authenticated} isAdmin={isAdmin} businesses={businesses} />}
      footer={<Footer />}
    >
      {/* Account Create Navigation Hotfix — the same `businesses` list
          the headers above already use for QuickCreateMenu, made
          reachable to AccountNav's own "More" menu on /account/* routes
          (where SiteChrome swaps those headers out for OwnerHeader — see
          that component's own comment — so QuickCreateMenu itself never
          renders there). One provider, no second fetch. */}
      <BusinessesProvider businesses={businesses}>{children}</BusinessesProvider>
    </SiteChrome>
  );
}
