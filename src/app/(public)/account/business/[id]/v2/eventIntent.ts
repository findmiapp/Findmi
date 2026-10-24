// Findmi Here → Events — the owner-facing intent vocabulary for adding an
// Event, mapped onto the EXISTING canonical workflows (no parallel Event or
// Where I'll Be records). Pure data: safe for server and client.
//
//   hosting   — an Event this Business organizes (events.host_business_id):
//               Event Import with intent=hosting, or the Event Manager.
//   appearing — something someone else hosts that this Business takes part
//               in (an Appearance / event participation): the existing
//               request-to-join composer (compose=1) — Search Findmi,
//               Import with intent=participating, or add manually.

export type AddEventIntent = "hosting" | "appearing";

/** `?add=event` opens the "What Are You Adding?" chooser on Events. */
export const ADD_EVENT_PARAM = "event";

/** The Events view with the chooser open. */
export function addEventHref(basePath: string): string {
  return `${basePath}?tab=findmi-here&add=${ADD_EVENT_PARAM}`;
}

/** The Events view with the chosen intent's panel open. */
export function addEventIntentHref(basePath: string, intent: AddEventIntent): string {
  return intent === "hosting" ? `${basePath}?tab=findmi-here&compose=hosting#add-hosting` : `${basePath}?tab=findmi-here&compose=1#going-somewhere`;
}

/** Event Import, carrying the intent it was started from. */
export function eventImportHref(businessId: string, intent: AddEventIntent): string {
  return `/account/business/${encodeURIComponent(businessId)}/import-event?intent=${intent === "hosting" ? "hosting" : "participating"}`;
}

/** Create a hosted Event by hand in the one Event Manager. */
export function hostEventHref(businessId: string): string {
  return `/account/event/new?business_id=${encodeURIComponent(businessId)}`;
}

/** Which intent panel `?compose=` opens (null = none). */
export function parseComposeIntent(raw: string | undefined): AddEventIntent | null {
  if (raw === "hosting") return "hosting";
  if (raw === "1" || raw === "appearing") return "appearing";
  return null;
}
