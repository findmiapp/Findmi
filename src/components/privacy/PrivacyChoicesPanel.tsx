"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import {
  fetchPrivacyChoices,
  readClientDeviceChoice,
  readClientGpc,
  savePrivacyChoices,
  type PrivacyChoicesState,
} from "@/lib/privacy/consent-client";
import { ANALYTICS_IDENTIFIER_DAYS } from "./copy";

/** One switch row. A real <button role="switch"> so keyboard and screen
 * readers get on/off state; `locked` renders the Essential row. */
function ChoiceRow({
  title,
  description,
  note,
  checked,
  locked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  note?: string | null;
  checked: boolean;
  locked?: boolean;
  disabled?: boolean;
  onChange?: (next: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div className="min-w-0">
        <p id={`${id}-title`} className="text-sm font-semibold text-ink">
          {title}
        </p>
        <p id={`${id}-desc`} className="mt-1 text-sm leading-relaxed text-ink/60">
          {description}
        </p>
        {note && <p className="mt-2 rounded-xl bg-findmi-50 px-3 py-2 text-xs leading-relaxed text-findmi-700">{note}</p>}
      </div>
      {locked ? (
        <span className="mt-0.5 shrink-0 rounded-full bg-black/[0.05] px-3 py-1 text-xs font-semibold text-ink/60">Always On</span>
      ) : (
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-desc`}
          disabled={disabled}
          onClick={() => onChange?.(!checked)}
          className={`relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-findmi focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 ${
            checked ? "bg-findmi" : "bg-black/15"
          }`}
        >
          <span
            aria-hidden="true"
            className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${checked ? "translate-x-6" : "translate-x-1"}`}
          />
        </button>
      )}
    </div>
  );
}

/** Privacy Choices: the full set of choices, shared by the /privacy-choices
 * page and the Manage Privacy Choices sheet. Every switch maps to real
 * behavior (lib/privacy/consent.ts); nothing here is decorative. */
export default function PrivacyChoicesPanel({ onSaved, onCancel }: { onSaved?: () => void; onCancel?: () => void }) {
  const [state, setState] = useState<PrivacyChoicesState | null>(null);
  const [analytics, setAnalytics] = useState(false);
  const [personalized, setPersonalized] = useState(true);
  const [marketing, setMarketing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPrivacyChoices()
      .then((s) => {
        if (cancelled) return;
        setState(s);
        setAnalytics((s.analytics ?? readClientDeviceChoice()) === "granted");
        setPersonalized(s.account?.personalizedDiscovery ?? true);
        setMarketing(s.account?.marketingEmail ?? false);
      })
      .catch(() => {
        if (cancelled) return;
        setState({ signedIn: false, gpc: readClientGpc(), analytics: readClientDeviceChoice(), account: null });
        setAnalytics(readClientDeviceChoice() === "granted");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const next = await savePrivacyChoices({
        analytics: analytics ? "granted" : "denied",
        ...(state?.signedIn ? { personalizedDiscovery: personalized, marketingEmail: marketing } : {}),
      });
      setState(next);
      setSaved(true);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your choices. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const signedIn = Boolean(state?.signedIn);
  const gpcNote =
    state?.gpc && !analytics
      ? "Your browser is sending a Global Privacy Control signal, so Analytics stays off unless you turn it on here."
      : null;

  return (
    <div>
      <div className="divide-y divide-black/5">
        <ChoiceRow
          title="Essential"
          description="Keeps Findmi working: signing in, security, your cart, items you save on this device, and remembering these choices."
          checked
          locked
        />
        <ChoiceRow
          title="Analytics"
          description={`First-party Findmi analytics that help us understand how people discover businesses, places, products and experiences, so we can improve Findmi. Uses a Findmi identifier kept for up to ${ANALYTICS_IDENTIFIER_DAYS} days. Findmi doesn't use it for advertising.`}
          note={gpcNote}
          checked={analytics}
          disabled={!state}
          onChange={setAnalytics}
        />
        <ChoiceRow
          title="Personalized Discovery"
          description={
            signedIn
              ? "Ranks discovery using the pages you follow and save and the items you organize. Turning this off doesn't change your saves, follows or lists."
              : "Available when you're signed in. Findmi doesn't personalize discovery for signed-out visitors."
          }
          checked={signedIn ? personalized : false}
          disabled={!signedIn}
          onChange={setPersonalized}
        />
        <ChoiceRow
          title="Marketing Emails"
          description={
            signedIn
              ? "Findmi doesn't send marketing emails today. If that changes, they'll only go to you while this is on. Account and service messages aren't affected."
              : "Available when you're signed in."
          }
          checked={signedIn ? marketing : false}
          disabled={!signedIn}
          onChange={setMarketing}
        />
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
      {saved && !error && (
        <p role="status" className="mt-3 text-sm font-medium text-findmi-700">
          Your choices are saved.
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || !state}
          className="rounded-full bg-findmi px-5 py-2.5 text-sm font-bold text-white transition hover:bg-findmi-600 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save Choices"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-black/10 px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-black/[0.03]"
          >
            Cancel
          </button>
        )}
        <Link href="/privacy" className="ml-auto text-sm font-medium text-ink/60 underline underline-offset-2 hover:text-ink">
          Privacy Policy
        </Link>
      </div>
    </div>
  );
}
