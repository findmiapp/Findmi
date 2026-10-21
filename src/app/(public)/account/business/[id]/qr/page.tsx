import { redirect } from "next/navigation";

/** The QR tab (`?tab=qr`) is the one Business Manager QR destination; this
 * old Campaign Manager URL redirects there. Campaign detail pages
 * (/account/qr/[id]) and the creator (/qr/new) are unchanged. */
export default async function BusinessQrManagerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/account/business/${id}?tab=qr`);
}
