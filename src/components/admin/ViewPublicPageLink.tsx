/**
 * The reverse of AdminEditButton — sits on an admin edit page and opens
 * that exact record's real public page in a new tab. `href` should be
 * computed by the caller from the record's actual current slug AND its
 * real publication state (e.g. `!business.is_demo && business.publication_status
 * === "live" ? `/business/${business.slug}` : null`) — pass null when the
 * record genuinely has no accessible public page yet, which renders a
 * plain status note instead of a link to a page that would 404.
 */
export default function ViewPublicPageLink({ href }: { href: string | null }) {
  if (!href) {
    return <span className="text-xs font-medium text-ink/35">Not published yet</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs font-semibold text-findmi-700 hover:underline"
    >
      View Page <span aria-hidden="true">↗</span>
    </a>
  );
}
