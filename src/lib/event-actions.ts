/** Event compact action hierarchy — shared styles and copy for the primary
 * transactional CTA and secondary intents. A plain module (no "use
 * client") so both the client EventScheduleCtas (multi-date, per selected
 * date) and the server single-date path in EventPublicView can use it. */
export const EVENT_PRIMARY_CTA_CLASS =
  "flex h-11 min-w-0 flex-1 items-center justify-center rounded-xl bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600";
export const EVENT_SECONDARY_CTA_CLASS =
  "inline-flex items-center gap-1 text-metadata font-bold text-findmi-700 underline-offset-2 transition hover:underline";

/** Secondary intents read as small contextual text actions, never as a
 * second full CTA — e.g. "Interested in vending? Apply →". */
export function secondaryCtaContent(label: string): { prompt: string | null; text: string } {
  if (label === "Apply to Vend") return { prompt: "Interested in vending?", text: "Apply →" };
  return { prompt: null, text: `${label} →` };
}

