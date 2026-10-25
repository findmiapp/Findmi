"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { OPEN_PRIVACY_CHOICES_EVENT, PRIVACY_CHOICE_CHANGED_EVENT, shouldShowFirstVisitCard } from "@/lib/privacy/consent";
import {
  readClientDeviceChoice,
  readClientGpc,
  savePrivacyChoices,
  syncPrivacyChoices,
} from "@/lib/privacy/consent-client";
import { takeQrArrivalParam } from "@/lib/privacy/qr-arrival";
import PrivacyChoicesPanel from "./PrivacyChoicesPanel";
import { FIRST_VISIT_BODY, FIRST_VISIT_TITLE } from "./copy";

const SYNC_FLAG = "findmi_privacy_synced_v1";
const QR_SENT_PREFIX = "findmi_qr_arrival:";

/** Deferred QR measurement (lib/privacy/qr-arrival.ts): once a choice
 * exists, record the arrival if Analytics was allowed, then remove the
 * marker from the address bar either way. */
function settleQrArrival() {
  if (typeof window === "undefined") return;
  const { code, search } = takeQrArrivalParam(window.location.search);
  if (!code) return;
  const choice = readClientDeviceChoice();
  const gpc = readClientGpc();
  if (choice === null && !gpc) return; // still undecided: keep the marker until they choose
  if (choice === "granted") {
    let alreadySent = false;
    try {
      alreadySent = window.sessionStorage.getItem(QR_SENT_PREFIX + code) === "1";
      window.sessionStorage.setItem(QR_SENT_PREFIX + code, "1");
    } catch {
      // storage unavailable: send once for this page view
    }
    if (!alreadySent) {
      fetch("/api/analytics/qr-arrival", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
        keepalive: true,
      }).catch(() => undefined);
    }
  }
  try {
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${search}${window.location.hash}`);
  } catch {
    // leave the URL as is
  }
}

/** Mounted once in each public layout (Findmi and JerseyCity.guide). Shows
 * the first-visit card only when no choice exists and no GPC signal is
 * present, opens the Manage sheet on request, and reconciles device and
 * account choices once per browser session for a signed-in visitor. */
export default function PrivacyChoicesRoot({ authenticated }: { authenticated: boolean }) {
  const [showCard, setShowCard] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pending, setPending] = useState<"granted" | "denied" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const refreshCard = useCallback(() => {
    setShowCard(shouldShowFirstVisitCard({ deviceChoice: readClientDeviceChoice(), gpc: readClientGpc() }));
  }, []);

  useEffect(() => {
    refreshCard();
    settleQrArrival();

    if (authenticated) {
      let synced = false;
      try {
        synced = window.sessionStorage.getItem(SYNC_FLAG) === "1";
      } catch {
        synced = false;
      }
      if (!synced) {
        syncPrivacyChoices()
          .then(() => {
            try {
              window.sessionStorage.setItem(SYNC_FLAG, "1");
            } catch {
              // fine: sync again next page
            }
            refreshCard();
            settleQrArrival();
          })
          .catch(() => undefined);
      }
    } else {
      try {
        window.sessionStorage.removeItem(SYNC_FLAG);
      } catch {
        // ignore
      }
    }

    function onOpen() {
      returnFocusRef.current = document.activeElement as HTMLElement | null;
      setSheetOpen(true);
    }
    function onChanged() {
      refreshCard();
      settleQrArrival();
    }
    window.addEventListener(OPEN_PRIVACY_CHOICES_EVENT, onOpen);
    window.addEventListener(PRIVACY_CHOICE_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(OPEN_PRIVACY_CHOICES_EVENT, onOpen);
      window.removeEventListener(PRIVACY_CHOICE_CHANGED_EVENT, onChanged);
    };
  }, [authenticated, refreshCard]);

  async function choose(choice: "granted" | "denied") {
    setPending(choice);
    setError(null);
    try {
      await savePrivacyChoices({ analytics: choice });
      setShowCard(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your choice. Please try again.");
    } finally {
      setPending(null);
    }
  }

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    refreshCard();
    returnFocusRef.current?.focus?.();
  }, [refreshCard]);

  return (
    <>
      {showCard && !sheetOpen && (
        <section
          aria-labelledby="privacy-card-title"
          className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-[60] mx-auto max-w-md rounded-3xl border border-findmi/20 bg-white p-4 shadow-[0_8px_32px_rgba(20,176,188,0.18)] sm:inset-x-auto sm:right-5 sm:p-5"
        >
          <h2 id="privacy-card-title" className="font-display text-base font-bold tracking-tight text-ink">
            {FIRST_VISIT_TITLE}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-ink/65">{FIRST_VISIT_BODY}</p>
          {error && (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => choose("granted")}
              disabled={pending !== null}
              className="rounded-full bg-findmi px-3 py-2.5 text-sm font-bold text-white transition hover:bg-findmi-600 disabled:opacity-60"
            >
              {pending === "granted" ? "Saving…" : "Allow Analytics"}
            </button>
            <button
              type="button"
              onClick={() => choose("denied")}
              disabled={pending !== null}
              className="rounded-full bg-ink px-3 py-2.5 text-sm font-bold text-white transition hover:bg-ink/85 disabled:opacity-60"
            >
              {pending === "denied" ? "Saving…" : "Essential Only"}
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              returnFocusRef.current = document.activeElement as HTMLElement | null;
              setSheetOpen(true);
            }}
            className="mt-3 w-full text-center text-sm font-semibold text-findmi-700 underline-offset-2 hover:underline"
          >
            Manage Privacy Choices
          </button>
        </section>
      )}
      {sheetOpen && <PrivacyChoicesSheet onClose={closeSheet} />}
    </>
  );
}

/** Manage Privacy Choices as a dialog. Escape and the backdrop close it
 * without saving; Tab stays inside while it's open. */
function PrivacyChoicesSheet({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const first = dialogRef.current?.querySelector<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])");
    first?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  function trap(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab" || !dialogRef.current) return;
    const items = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])")
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-sheet-title"
        onKeyDown={trap}
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-black/5 bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:rounded-3xl sm:pb-5"
      >
        <h2 id="privacy-sheet-title" className="font-display text-lg font-bold tracking-tight text-ink">
          Privacy Choices
        </h2>
        <p className="mt-1 text-sm text-ink/60">Choose what Findmi may use beyond what it needs to work. You can change this at any time.</p>
        <div className="mt-2">
          <PrivacyChoicesPanel onSaved={onClose} onCancel={onClose} />
        </div>
      </div>
    </div>,
    document.body
  );
}
