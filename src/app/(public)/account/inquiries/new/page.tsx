import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Launch V2 Pass 1 — Section 12. The legacy native-inquiry compose flow
 * is retired; every real inquiry entry point today is a public
 * InquireButton (Business/Product/Event/Venue), which already creates a
 * canonical Conversation directly — there is no owner-facing "compose"
 * step to replace here. */
export default function LegacyAccountInquiryComposePage() {
  redirect("/account/messages");
}
