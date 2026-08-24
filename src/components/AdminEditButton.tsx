import Link from "next/link";
import { isAdminSession } from "@/lib/admin/auth";

/**
 * Founder-only deep link from a public page straight into that record's
 * admin editor — completely absent for ordinary visitors. Authorization
 * reuses the exact same signed httpOnly session cookie that gates every
 * /admin route (see src/lib/admin/auth.ts / src/middleware.ts), read
 * server-side here — never a client-side flag, query param, or
 * localStorage value, so it can't be spoofed by opening devtools.
 *
 * Server Component by design (isAdminSession() reads next/headers
 * cookies()) — render it directly inside any public page's JSX.
 */
export default async function AdminEditButton({
  href,
  className = "",
}: {
  href: string;
  className?: string;
}) {
  const isAdmin = await isAdminSession();
  if (!isAdmin) return null;

  return (
    <Link
      href={href}
      title="Edit in Admin"
      aria-label="Edit in Admin"
      className={`flex h-9 w-9 items-center justify-center rounded-xl border border-black/10 bg-white/90 text-ink/70 shadow-sm backdrop-blur transition hover:border-black/20 hover:text-ink ${className}`}
    >
      <PencilIcon className="h-4 w-4" />
    </Link>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M4 20h4L18.5 9.5a2 2 0 000-2.8l-1.2-1.2a2 2 0 00-2.8 0L4 16v4z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M13 6l3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
