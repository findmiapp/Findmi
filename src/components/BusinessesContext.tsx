"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { BusinessOption } from "@/app/(public)/account/BusinessScopedAction";

const BusinessesContext = createContext<BusinessOption[]>([]);

/** Account Create Navigation Hotfix — makes the managed-Business list
 * (public)/layout.tsx already fetches once per request (for the public
 * header's QuickCreateMenu) reachable by any client component further
 * down the tree, e.g. AccountNav's own "More" menu, without a second
 * Supabase round trip and without prop-drilling `businesses` through
 * every /account/* page.tsx that renders AccountNav. Empty array default
 * matches every existing zero-business call site (signed out / no
 * memberships yet). */
export function BusinessesProvider({ businesses, children }: { businesses: BusinessOption[]; children: ReactNode }) {
  return <BusinessesContext.Provider value={businesses}>{children}</BusinessesContext.Provider>;
}

export function useBusinesses(): BusinessOption[] {
  return useContext(BusinessesContext);
}
