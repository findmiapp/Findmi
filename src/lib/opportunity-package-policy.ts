// Opportunities — temporary single-package policy (Phase 2).
//
// The multi-package architecture (several opportunity_options per
// listing, the builder, the RPC, the Business rendering) stays intact.
// Until package-specific responses exist (selection, switching,
// snapshots, Admin visibility), two switches keep it from being used
// ambiguously:
//   - PACKAGES_ENABLED: no new multi-package listings, and no package can
//     be added to an existing listing. Existing multi-package listings
//     stay readable and editable (edit or remove packages) — nothing is
//     collapsed, converted or deleted automatically.
//   - PACKAGE_RESPONSES_ENABLED: on a listing with more than one package,
//     an Opportunity-level "I'm Interested" is refused server-side (both
//     invited responses and Explore interest) — the Business is asked to
//     contact Findmi to choose a package instead. Single-package and
//     legacy (zero-package) listings keep today's Interested workflow.
//
// Zero imports so `node --test` can import it directly, like the domain
// module.

export const PACKAGES_ENABLED = false;
export const PACKAGE_RESPONSES_ENABLED = false;

export const PACKAGE_ADD_BLOCKED_MESSAGE =
  "Opportunities currently have one package. Existing packages can be edited or removed, but new packages can't be added yet.";

/** Server-side gate for a create/save. `existingIds` are the listing's
 * CURRENT opportunity_options ids read from the database (empty for a new
 * Opportunity); `submitted` are the packages about to be saved. */
export function packageEditError(
  existingIds: readonly string[],
  submitted: readonly { id: string | null }[],
  packagesEnabled: boolean = PACKAGES_ENABLED
): string | null {
  if (packagesEnabled) return null;
  if (submitted.length > Math.max(1, existingIds.length)) return PACKAGE_ADD_BLOCKED_MESSAGE;
  if (submitted.length > 1) {
    const known = new Set(existingIds);
    // A multi-package listing may only keep (edit) packages it already has.
    if (submitted.some((o) => !o.id || !known.has(o.id))) return PACKAGE_ADD_BLOCKED_MESSAGE;
  }
  return null;
}

export const CHOOSE_PACKAGE_MESSAGE = "This Opportunity has more than one package. Contact Findmi to choose the one you'd like.";

/** True when an Opportunity-level "I'm Interested" would be ambiguous. */
export function requiresPackageChoice(packageCount: number, packageResponsesEnabled: boolean = PACKAGE_RESPONSES_ENABLED): boolean {
  return !packageResponsesEnabled && packageCount > 1;
}

/** Fallback when no site contact email is configured — the same
 * hello@findmi.app convention the Terms page and Join CTA already use. */
export const FINDMI_CONTACT_EMAIL_FALLBACK = "hello@findmi.app";

/** The working "Contact Findmi to Choose a Package" action: a mailto with
 * the Opportunity and Business already filled in. */
export function choosePackageMailto(args: { email: string | null; opportunityTitle: string; businessName: string | null }): string {
  const to = args.email?.trim() || FINDMI_CONTACT_EMAIL_FALLBACK;
  const subject = `Package choice: ${args.opportunityTitle}`;
  const body = [
    `Hi Findmi — we're interested in "${args.opportunityTitle}" and would like to choose a package.`,
    "",
    `Business: ${args.businessName ?? ""}`,
    "Package we'd like: ",
    "",
  ].join("\n");
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
