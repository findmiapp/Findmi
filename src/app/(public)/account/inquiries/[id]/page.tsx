import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Launch V2 Pass 1 — Section 12. A legacy inquiry id has no canonical
 * Conversation counterpart to redirect to (the two systems are entirely
 * separate tables — see this pass's own audit), so this safely lands on
 * the Inbox itself rather than a dead thread view. */
export default function LegacyAccountInquiryThreadPage() {
  redirect("/account/messages");
}
