"use client";

import { useEffect } from "react";
import { syncLocalToAccountOnce } from "@/lib/accountSync";

/** Fires the one-time local→account import (lib/accountSync.ts) the
 * moment an authenticated visitor lands on the My FindMi home page —
 * every /account/* route is already auth-gated by middleware, so there's
 * no guest case to handle here. Renders nothing. AccountNav (shown on
 * every other /account/* subpage) triggers the same import, so it isn't
 * duplicated only here. */
export default function AccountSync() {
  useEffect(() => {
    syncLocalToAccountOnce();
  }, []);
  return null;
}
