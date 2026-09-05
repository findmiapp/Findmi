import { goToRedeemCode } from "@/app/(public)/redeem/actions";

/**
 * Pro Invite Sharing UX pass — the manual "Option B" entry point (Option
 * A is the existing findmi.app/join?invite=CODE link): a vendor who was
 * given a code verbally/by text/on a printed card types it in here
 * instead. A plain server component (no client JS needed) — submitting
 * goes straight to goToRedeemCode (redeem/actions.ts), which does
 * nothing but normalize the code and redirect to /redeem/[code]; that
 * route is the ONLY place any invite is looked up or redeemed, exactly
 * as with the existing link flow. `required` on the input blocks a blank
 * submission client-side (no navigation at all); goToRedeemCode
 * re-checks server-side too rather than trusting that alone.
 */
export default function ProInviteCodeEntry({
  returnTo,
  businessId,
  heading = "Have a Pro Invite Code?",
  helperText,
}: {
  returnTo: string;
  businessId?: string;
  // Admin Join Page Editor pass — /join passes its own founder-editable
  // heading/helperText (lib/join-page.ts's resolveJoinInviteSection);
  // every other caller (account, account/business/[id]) omits these and
  // keeps rendering exactly as before.
  heading?: string;
  helperText?: string | null;
}) {
  return (
    <div className="rounded-2xl border border-black/10 bg-mist/40 p-4">
      <p className="text-sm font-semibold text-ink/70">{heading}</p>
      {helperText && <p className="mt-1 text-xs text-ink/50">{helperText}</p>}
      <form action={goToRedeemCode} className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input type="hidden" name="return_to" value={returnTo} />
        {businessId && <input type="hidden" name="business" value={businessId} />}
        <input
          type="text"
          name="code"
          required
          placeholder="Enter Invite Code"
          className="w-full min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
        />
        <button
          type="submit"
          className="shrink-0 rounded-full border border-black/15 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-ink transition hover:border-black/30"
        >
          Apply Code
        </button>
      </form>
    </div>
  );
}
