import Link from "next/link";
import type { BdContact } from "@/lib/admin/bd/contacts";
import { ArchivedPill } from "../BdPills";

/** One compact Contact card row — used by the Contacts list and an
 * Organization's Contacts section. `showOrganization` is off inside an
 * Organization page, where it would only repeat the page's own name. */
export default function ContactRow({ contact, showOrganization = true }: { contact: BdContact; showOrganization?: boolean }) {
  const subtitle = [contact.title, showOrganization ? contact.organization?.name : null].filter(Boolean).join(" · ");
  return (
    <Link
      href={`/admin/bd/contacts/${contact.id}`}
      className="flex items-center justify-between gap-3 rounded-xl border border-black/5 bg-white px-4 py-3 transition hover:border-black/10"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-ink">{contact.name}</p>
        {subtitle && <p className="truncate text-xs text-ink/55">{subtitle}</p>}
        {contact.email && <p className="truncate text-xs text-ink/45">{contact.email}</p>}
      </div>
      {contact.archived_at && <ArchivedPill />}
    </Link>
  );
}
