"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  INTENT_LABELS,
  INTENT_REASONS,
  REPORTER_RELATIONSHIPS,
  REPORTER_RELATIONSHIP_LABELS,
  REPORT_REASON_LABELS,
  kindFor,
  type ReportEntityType,
  type ReportIntent,
  type ReportReason,
  type ReporterRelationship,
} from "@/lib/reports-domain";

const INTENT_INTRO: Record<ReportIntent, string> = {
  correction: "Tell Findmi what's wrong and what it should say. Findmi reviews every suggestion.",
  removal: "Ask Findmi to review this for removal. Findmi reviews every request; nothing is removed automatically.",
  report: "Tell Findmi what's wrong. Findmi reviews every report.",
};

/** Suggest A Correction / Request Removal / Report: one small dialog for
 * all three (rules in lib/reports-domain). Free, no account needed for
 * public pages, and separate from claiming a page. */
export default function ReportDialog({
  entityType,
  entityId,
  entityName,
  intent,
  signedIn,
  onClose,
}: {
  entityType: ReportEntityType;
  entityId: string;
  entityName: string;
  intent: ReportIntent;
  signedIn: boolean;
  onClose: () => void;
}) {
  const reasons = INTENT_REASONS[intent];
  const [reason, setReason] = useState<ReportReason>(reasons[0]);
  const [details, setDetails] = useState("");
  const [relationship, setRelationship] = useState<ReporterRelationship | "">("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const kind = kindFor(intent, reason);
  const isRights = kind === "copyright" || kind === "trademark";

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>("select, textarea, button")?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType,
          entityId,
          intent,
          reason,
          details,
          relationship: relationship || undefined,
          evidenceUrl: evidenceUrl || undefined,
          email: signedIn ? undefined : email || undefined,
          website,
        }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Couldn't send that. Please try again.");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send that. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const input = "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";
  const label = "mb-1.5 block text-xs font-medium text-ink";

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-dialog-title"
        className="relative max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:rounded-3xl sm:pb-5"
      >
        <h2 id="report-dialog-title" className="font-display text-lg font-bold tracking-tight text-ink">
          {sent ? "Thanks, Findmi Has It" : INTENT_LABELS[intent]}
        </h2>
        {sent ? (
          <div className="mt-3">
            <p className="text-sm leading-relaxed text-ink/65">
              Findmi will review it. {signedIn || email ? "If Findmi needs anything else, it may follow up by email." : ""}
            </p>
            <button type="button" onClick={onClose} className="mt-4 w-full rounded-full bg-findmi px-5 py-2.5 text-sm font-bold text-white transition hover:bg-findmi-600">
              Done
            </button>
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-3">
            <p className="text-sm leading-relaxed text-ink/60">
              {INTENT_INTRO[intent]} <span className="font-medium text-ink/75">{entityName}</span>
            </p>
            <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
              <label>
                Leave this field blank
                <input type="text" tabIndex={-1} autoComplete="off" autoCapitalize="none" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </label>
            </div>
            {reasons.length > 1 && (
              <label className="block">
                <span className={label}>Reason</span>
                <select value={reason} onChange={(e) => setReason(e.target.value as ReportReason)} className={input}>
                  {reasons.map((r) => (
                    <option key={r} value={r}>
                      {REPORT_REASON_LABELS[r]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block">
              <span className={label}>
                {intent === "correction" ? "What should be corrected?" : isRights ? "Describe the work or mark and where it appears" : "Details (optional)"}
              </span>
              <textarea autoCapitalize="sentences" rows={4} value={details} onChange={(e) => setDetails(e.target.value)} className={input} maxLength={4000} />
            </label>
            {(isRights || intent === "removal") && (
              <label className="block">
                <span className={label}>Your relationship to this{isRights ? "" : " (optional)"}</span>
                <select value={relationship} onChange={(e) => setRelationship(e.target.value as ReporterRelationship | "")} className={input}>
                  <option value="">Choose one</option>
                  {REPORTER_RELATIONSHIPS.map((r) => (
                    <option key={r} value={r}>
                      {REPORTER_RELATIONSHIP_LABELS[r]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(isRights || intent === "correction") && (
              <label className="block">
                <span className={label}>{isRights ? "Link to the original work or registration (optional)" : "Link to a source (optional)"}</span>
                <input type="url" inputMode="url" autoCapitalize="none" value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)} className={input} placeholder="https://" />
              </label>
            )}
            {!signedIn && (
              <label className="block">
                <span className={label}>Email (optional, only if you&rsquo;d like a reply)</span>
                <input type="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
              </label>
            )}
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className="flex-1 rounded-full bg-findmi px-5 py-2.5 text-sm font-bold text-white transition hover:bg-findmi-600 disabled:opacity-60"
              >
                {pending ? "Sending…" : "Send To Findmi"}
              </button>
              <button type="button" onClick={onClose} className="rounded-full border border-black/10 px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-black/[0.03]">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
