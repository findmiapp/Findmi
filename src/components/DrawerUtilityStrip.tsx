"use client";

import CartBadge from "./CartBadge";

/**
 * Thin utility row at the very top of the mobile drawer — Cart only
 * (Menu Polish + Editable About pass). Email/Phone used to live here as
 * two random, unlabeled icons; removed per this pass's own instruction —
 * contacting Findmi is now an intentional action on /about's own Contact
 * section (see AboutPage), not unexplained drawer chrome. The underlying
 * founder-editable email/phone configuration (Admin → Site → Contact
 * Info — lib/contact-info.ts) is untouched; only THIS presentation of it
 * is gone. Cart is the exact same CartBadge already used in MobileHeader
 * (icon variant, same live localStorage count) — a legitimate, active
 * global commerce entry point (see the multi-vendor cart/checkout
 * system), so it stays. `onNavigate` closes the drawer, same as every
 * other drawer link.
 */
export default function DrawerUtilityStrip({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="flex shrink-0 items-center border-b border-black/5 px-4 py-2">
      <span onClick={onNavigate}>
        <CartBadge />
      </span>
    </div>
  );
}
