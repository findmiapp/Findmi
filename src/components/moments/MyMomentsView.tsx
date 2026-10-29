import Link from "next/link";
import type { MomentFeedPage } from "@/lib/moment-discovery";
import { ADD_MOMENT_HREF, myMomentsAuthHrefs, type MomentFeedState } from "@/lib/moment-filters";
import MomentsDiscovery from "./MomentsDiscovery";
import MomentsModeTabs from "./MomentsModeTabs";

/** /moments → My Moments: the signed-in person's OWN Moments as the SAME
 * canonical feed — MomentsDiscovery, MomentDiscoveryCard, category chips,
 * Feed / Map — over their owner-scoped cards (drafts and private Moments
 * badged). Their chronological history is My Journal, linked from the feed.
 * Signed out: what My Moments is, plus Log In / Create Account returning
 * here — never a fake "you have no Moments". */
export default function MyMomentsView({
  page,
  state,
  cursor,
}: {
  page: MomentFeedPage | null;
  state: MomentFeedState;
  cursor: string | null;
}) {
  if (page === null) {
    return (
      <div>
        <MomentsModeTabs active="my-moments" />
        <SignedOut />
      </div>
    );
  }
  if (page.cards.length === 0 && !cursor) {
    return (
      <div>
        <MomentsModeTabs active="my-moments" />
        <div className="mt-4 rounded-2xl border border-dashed border-black/15 px-5 py-8 text-center">
          <p className="font-display text-base font-bold text-ink">Your Moments will appear here.</p>
          <p className="mx-auto mt-1 max-w-xs text-sm text-ink/55">Capture a place you visited, something you tried or an event you went to.</p>
          <Link href={ADD_MOMENT_HREF} className="mt-4 inline-flex h-10 items-center rounded-full bg-findmi px-4 text-sm font-bold text-white hover:bg-findmi-600">
            Add Moment
          </Link>
        </div>
      </div>
    );
  }
  return <MomentsDiscovery cards={page.cards} layout="grid" initialState={state} pagination={{ basePath: "/moments", cursor, nextCursor: page.nextCursor }} />;
}

function SignedOut() {
  const { login, signup } = myMomentsAuthHrefs();
  return (
    <div className="mt-4 rounded-2xl border border-black/[0.08] bg-white px-5 py-6">
      <p className="font-display text-base font-bold text-ink">Your Own Moments, In One Place</p>
      <p className="mt-1 text-sm text-ink/60">My Moments holds the experiences you document on Findmi — the places, brands and events you&rsquo;ve lived — so you can revisit them anytime.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={login} className="inline-flex h-10 items-center rounded-full bg-findmi px-4 text-sm font-bold text-white hover:bg-findmi-600">
          Log In
        </Link>
        <Link href={signup} className="inline-flex h-10 items-center rounded-full border border-black/10 px-4 text-sm font-bold text-ink hover:border-black/20">
          Create Account
        </Link>
      </div>
    </div>
  );
}
