"use client";

import { useState } from "react";
import { setBusinessInquirySettings } from "../inquiries-actions";
import { BUSINESS_INQUIRY_TOPIC_LABELS, BUSINESS_INQUIRY_TOPIC_VALUES, type BusinessInquiryTopic } from "@/lib/business-inquiry-topics";

/** Business-Controlled Inquiry Settings pass, corrected — the original
 * CSS-only `group-has-[...]:block` reveal never worked: Tailwind's
 * arbitrary-value syntax treats an underscore inside `[...]` as an
 * escaped space, so `[name=accepts_inquiries]` compiled to the literal,
 * always-false selector `[name=accepts inquiries]` (confirmed in the
 * generated CSS) — a CSS-generation defect, not a data/render one
 * (accepts_inquiries/inquiry_topics were loading and saving correctly
 * the whole time). Real React state removes that fragility entirely and
 * reacts immediately, no Save/reload needed to see Inquiry Types appear.
 *
 * Still submits through the exact same 6bf7132 server action
 * (setBusinessInquirySettings) via a plain <form action> — importing a
 * "use server" action directly into a Client Component and using it as
 * a form's action is the same supported pattern MessageButton.tsx
 * already uses for its own Server Action calls. */
export default function CustomerInquiriesForm({
  businessId,
  defaultAcceptsInquiries,
  defaultTopics,
}: {
  businessId: string;
  defaultAcceptsInquiries: boolean;
  defaultTopics: BusinessInquiryTopic[];
}) {
  const [accepted, setAccepted] = useState(defaultAcceptsInquiries);
  const [topics, setTopics] = useState<Set<BusinessInquiryTopic>>(new Set(defaultTopics));

  function toggleTopic(value: BusinessInquiryTopic) {
    setTopics((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  const showZeroTopicWarning = accepted && topics.size === 0;

  return (
    <form action={setBusinessInquirySettings.bind(null, businessId)} className="rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
      <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Customer Inquiries</p>
      <label className="mt-3 flex items-start gap-3">
        <input
          type="checkbox"
          name="accepts_inquiries"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-findmi"
        />
        <span>
          <span className="block text-sm font-medium text-ink">Accept inquiries</span>
          <span className="block text-xs text-ink/45">Allow customers to contact your business through Findmi.</span>
        </span>
      </label>

      {accepted && (
        <div className="mt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Inquiry Types</p>
          <p className="mt-1 text-xs text-ink/45">Choose what customers can contact you about.</p>
          <div className="mt-2 flex flex-col gap-1.5">
            {BUSINESS_INQUIRY_TOPIC_VALUES.map((value) => (
              <label key={value} className="flex items-center gap-2.5 rounded-lg px-1 py-1 hover:bg-black/[0.02]">
                <input
                  type="checkbox"
                  name="inquiry_topics"
                  value={value}
                  checked={topics.has(value)}
                  onChange={() => toggleTopic(value)}
                  className="h-4 w-4 shrink-0 accent-findmi"
                />
                <span className="text-sm text-ink/80">{BUSINESS_INQUIRY_TOPIC_LABELS[value]}</span>
              </label>
            ))}
          </div>
          {showZeroTopicWarning && (
            <p className="mt-2 text-xs text-red-600">Choose at least one inquiry type, or customers won&rsquo;t see an Inquire button.</p>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={showZeroTopicWarning}
        className="mt-4 rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Save
      </button>
    </form>
  );
}
