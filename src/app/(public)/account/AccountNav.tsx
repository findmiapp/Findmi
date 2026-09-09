"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { syncLocalToAccountOnce } from "@/lib/accountSync";
import SignOutConfirm from "@/components/SignOutConfirm";
import { signOut } from "./profile/actions";

const TABS = [
  { href: "/account", label: "Home" },
  { href: "/account/saved", label: "Saved" },
  { href: "/account/following", label: "Following" },
  { href: "/account/inquiries", label: "Inquiries" },
  { href: "/account/messages", label: "Messages" },
  { href: "/account/orders", label: "Orders" },
  { href: "/account/profile", label: "Profile" },
];

/** Shared tab strip for every /account/* subpage (Saved/Following/Orders/
 * Profile) — not the home page itself, which already serves as the
 * section's own entry point via its nav cards. Lets a visitor move
 * between sections without going back through Home each time, which
 * matters most on mobile where there's no persistent sidebar. Same pill/
 * findmi-accent language as the rest of the public site's nav/badge
 * treatments — no new pattern invented. */
export default function AccountNav() {
  const pathname = usePathname();

  // Every page that renders this tab strip is already an authenticated
  // /account/* route — piggyback the one-time local→account import here
  // (see AccountSync on the Home page, which doesn't render this nav) so
  // it also fires on Saved/Following/Orders/Profile, not just Home.
  useEffect(() => {
    syncLocalToAccountOnce();
  }, []);

  return (
    <nav aria-label="Account" className="-mx-4 mb-6 flex items-center gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      {TABS.map((tab) => {
        const active = tab.href === "/account" ? pathname === "/account" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold transition ${
              active ? "bg-findmi text-white" : "bg-black/[0.04] text-ink/60 hover:bg-black/[0.07]"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
      {/* Account Hub V1 — Sign Out must always be reachable without a trip
          to Profile first; this strip is shared by every /account/*
          subpage (including Business Manager, which renders this same
          nav), so putting it here covers all of them from one place.
          Sign-Out Confirmation pass — wrapped in SignOutConfirm so an
          accidental tap can't immediately end the session; same signOut
          action, same styling, just a confirm step first. */}
      <SignOutConfirm
        action={signOut}
        className="ml-auto shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold text-ink/40 transition hover:bg-black/[0.04] hover:text-ink/70"
      >
        Sign Out
      </SignOutConfirm>
    </nav>
  );
}
