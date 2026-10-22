"use client";

import MomentDisplayControl from "@/components/account/MomentDisplayControl";
import type { MomentDisplayState } from "@/lib/entity-moment-display";
import { setMomentProfileDisplayAction } from "../moment-display-actions";

/** Show / Hide / Feature a Moment on THIS Business's public profile — see
 * components/account/MomentDisplayControl for the rules. */
export default function MomentProfileControl({ businessId, entryId, initialHidden, initialFeatured = false }: { businessId: string; entryId: string; initialHidden: boolean; initialFeatured?: boolean }) {
  const initial: MomentDisplayState = initialHidden ? "hidden" : initialFeatured ? "featured" : "shown";
  return <MomentDisplayControl initial={initial} noun="Profile" action={(display) => setMomentProfileDisplayAction(businessId, entryId, display)} />;
}
