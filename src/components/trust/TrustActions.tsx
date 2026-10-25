"use client";

import { useState } from "react";
import { INTENT_LABELS, intentsFor, type ReportEntityType, type ReportIntent } from "@/lib/reports-domain";
import { getAccountSession } from "@/lib/accountSession";
import ReportDialog from "./ReportDialog";

/** The quiet row of trust actions (Suggest A Correction · Request Removal ·
 * Report) for one piece of public content. */
export default function TrustActions({
  entityType,
  entityId,
  entityName,
  className = "",
}: {
  entityType: ReportEntityType;
  entityId: string;
  entityName: string;
  className?: string;
}) {
  const [intent, setIntent] = useState<ReportIntent | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  async function open(next: ReportIntent) {
    setSignedIn(await getAccountSession().catch(() => false));
    setIntent(next);
  }

  return (
    <>
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 ${className}`}>
        {intentsFor(entityType).map((i) => (
          <button key={i} type="button" onClick={() => open(i)} className="min-h-9 text-metadata font-semibold text-ink/55 underline-offset-2 transition hover:text-ink hover:underline">
            {INTENT_LABELS[i]}
          </button>
        ))}
      </div>
      {intent && <ReportDialog entityType={entityType} entityId={entityId} entityName={entityName} intent={intent} signedIn={signedIn} onClose={() => setIntent(null)} />}
    </>
  );
}
