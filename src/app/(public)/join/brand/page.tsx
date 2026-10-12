import type { Metadata } from "next";
import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import NavIcon from "@/components/NavIcon";
import ChevronIcon from "@/components/ChevronIcon";
import SupabaseImage from "@/components/SupabaseImage";
import {
  BRAND_BUILD_RESUME_PARAM,
  BRAND_QUERY_MAX_LENGTH,
  brandBuildSignInHref,
  claimHref,
  classifyBrandInput,
  createHref,
  defaultBrandLookupDeps,
  lookupBrand,
  searchHref,
  type BrandInputKind,
  type BrandLookupResult,
  type PublicBrandCard,
} from "@/lib/brand-lookup";
import { isBrandLookupRateLimited } from "@/lib/brand-lookup-rate-limit";
import { brandSeedEntries, sanitizeBrandSeed, type BrandSeed } from "@/lib/brand-candidate";
import { buildBrandProfile } from "./actions";
import BuildProfileButton from "./BuildProfileButton";
import AutoBuild from "./AutoBuild";

export const metadata: Metadata = {
  title: "Find Your Brand",
  robots: { index: false },
};
// Per-request lookup + session-aware links — never cached.
export const dynamic = "force-dynamic";
// Build My Brand Profile (V1.1B) runs one bounded website fetch (8 s
// deadline) plus matching inside this route's server action.
export const maxDuration = 30;

/** Brand Onboarding V1 · Pass 2B — the public "Find or Add Your Brand"
 * front door. Server-rendered GET (/join/brand?q=…&as=…): no JSON API, no
 * client state — lib/brand-lookup.ts does the matching server-side and
 * returns only public display fields. Not behind middleware: looking up is
 * anonymous; signing in happens only when the visitor chooses Claim (the
 * existing ClaimButton flow) or Add (the existing /account/business/new
 * flow, which re-checks duplicates on submit). A plain form submission is
 * the loading behavior — the browser's own navigation progress — so no
 * client component is needed. */

type PageState =
  | { kind: "initial" }
  | { kind: "invalid"; message: string; value: string; nameFallback: boolean }
  | { kind: "rate_limited"; value: string }
  | { kind: "error"; value: string }
  | { kind: "result"; value: string; inputKind: BrandInputKind; alternative: BrandInputKind | null; result: BrandLookupResult };

const KIND_LABEL: Record<BrandInputKind, string> = { website: "website", instagram: "Instagram", name: "name" };

async function resolveState(q: string | undefined, as: string | undefined, authenticated: boolean): Promise<PageState> {
  const classified = classifyBrandInput(q, as);
  const value = (q ?? "").trim().slice(0, BRAND_QUERY_MAX_LENGTH);
  if (!classified.ok && classified.reason === "empty") return { kind: "initial" };
  if (await isBrandLookupRateLimited()) return { kind: "rate_limited", value };
  if (!classified.ok) {
    const message =
      classified.reason === "too_short"
        ? "Enter at least 2 characters."
        : classified.reason === "too_long"
          ? "That's a little long. Try a shorter name, website or handle."
          : classified.kind === "instagram"
            ? "That doesn't look like an Instagram handle. Try @yourbrand or an instagram.com link."
            : classified.kind === "website"
              ? "That doesn't look like a website. Try something like yourbrand.com."
              : "Enter your business name, website or Instagram.";
    return { kind: "invalid", message, value, nameFallback: classified.kind !== "name" && classified.reason === "invalid" };
  }
  const deps = defaultBrandLookupDeps();
  if (!deps) return { kind: "error", value };
  try {
    const result = await lookupBrand(classified, authenticated, deps);
    return { kind: "result", value: classified.value, inputKind: classified.kind, alternative: classified.alternative, result };
  } catch {
    return { kind: "error", value };
  }
}

export default async function FindYourBrandPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; as?: string; notice?: string; seed_name?: string; seed_instagram?: string; build?: string }>;
}) {
  const { q, as, notice, seed_name: seedName, seed_instagram: seedInstagram, build } = await searchParams;
  // V1.1B correction — a website searched from the name/Instagram website
  // prompt carries the original search as a bounded seed (validated here,
  // only ever used for a website search).
  const seed = as === "website" ? sanitizeBrandSeed({ name: seedName, instagram: seedInstagram }) : {};
  const hasSeed = Boolean(seed.name || seed.instagram);
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const authenticated = Boolean(user);
  // V1.1B — website analysis found a matching Business that isn't public:
  // the same generic assistance state as the lookup (signed-in only; it
  // names nothing). Anonymous visitors just get the ordinary page.
  if (notice === "already_listed" && authenticated) {
    return (
      <div className="mx-auto max-w-lg px-6 py-8 sm:py-12">
        <AssistanceBlock />
      </div>
    );
  }
  const state = await resolveState(q, as, authenticated);

  return (
    <div className="mx-auto max-w-lg px-6 py-8 sm:py-12">
      {state.kind === "initial" && (
        // On tall screens the search sits a little lower instead of being
        // pinned under the header above a large empty viewport; short
        // screens (and an open keyboard) keep the compact layout.
        <div className="[@media(min-height:700px)]:pt-[8vh]">
          <h1 className="font-display text-page-title font-bold tracking-tight text-ink">Find Your Brand</h1>
          <p className="mt-1.5 text-sm text-ink/60">
            Search for your business on Findmi. If it&rsquo;s already here, claim it. If not, add it in a few minutes.
          </p>
          <SearchForm value="" />
          <p className="mt-5 text-center text-sm text-ink/50">
            Just browsing?{" "}
            <Link href="/businesses" className="font-semibold text-ink hover:underline">
              Explore Businesses
            </Link>
          </p>
        </div>
      )}

      {state.kind === "invalid" && hasSeed && (
        <WebsitePrompt
          title="Check Your Website"
          body={state.message}
          seed={seed}
          addHref={seed.name ? createHref({ kind: "name", value: seed.name }) : createHref({ kind: "instagram", value: seed.instagram ?? "" })}
          value={state.value}
        />
      )}

      {state.kind === "invalid" && !hasSeed && (
        <StateBlock title="Check Your Entry" body={state.message}>
          <SearchForm value={state.value} />
          {state.nameFallback && <AltLink href={searchHref(state.value, "name")} label="Search as a Name Instead" />}
        </StateBlock>
      )}

      {state.kind === "rate_limited" && (
        <StateBlock title="Please Wait a Moment" body="You've searched a lot in a short time. Please try again in a few minutes.">
          <SecondaryLink href="/join/brand" label="Search Again" />
        </StateBlock>
      )}

      {state.kind === "error" && (
        <StateBlock title="Something Went Wrong" body="We couldn't complete that search. Please try again.">
          <PrimaryLink href={searchHref(state.value || "")} label="Try Again" />
        </StateBlock>
      )}

      {state.kind === "result" && (
        <ResultView
          value={state.value}
          inputKind={state.inputKind}
          alternative={state.alternative}
          result={state.result}
          authenticated={authenticated}
          seed={seed}
          resumeBuild={build === "1"}
        />
      )}
    </div>
  );
}

function ResultView({
  value,
  inputKind,
  alternative,
  result,
  authenticated,
  seed,
  resumeBuild,
}: {
  value: string;
  inputKind: BrandInputKind;
  alternative: BrandInputKind | null;
  result: BrandLookupResult;
  authenticated: boolean;
  seed: BrandSeed;
  /** Back from sign-in / sign-up after pressing Build (build=1). */
  resumeBuild: boolean;
}) {
  const addHref = createHref({ kind: inputKind, value }, inputKind === "website" ? seed : null);
  const searched = (
    <p className="mt-1.5 text-xs text-ink/50">
      Searched by {KIND_LABEL[inputKind]}: <span className="font-semibold text-ink/70">{value}</span>
      {alternative === "name" && (
        <>
          {" · "}
          <Link href={searchHref(value, alternative)} className="font-semibold text-findmi-700 hover:underline">
            Search as a Name Instead
          </Link>
        </>
      )}
    </p>
  );

  if (result.state === "strong" || result.state === "possible") {
    const single = result.state === "strong" && result.candidates.length === 1;
    return (
      <>
        <h1 className="font-display text-page-title font-bold tracking-tight text-ink">
          {single ? "Is This Your Brand?" : "Is One of These Yours?"}
        </h1>
        {searched}
        <ul className="mt-5 flex flex-col gap-3">
          {result.candidates.map((card) => (
            <li key={card.slug}>
              <BrandCard card={card} claimUrl={claimHref(card.slug, authenticated)} />
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink/50">Claiming starts a quick review by Findmi before you can manage the listing.</p>
        <SecondaryLink href={addHref} label={single ? "Not Mine — Add Your Brand" : "None of These — Add Your Brand"} />
        <SecondaryLink href="/join/brand" label="Search Again" subtle />
      </>
    );
  }

  if (result.state === "assistance") return <AssistanceBlock>{searched}</AssistanceBlock>;

  // V1.1B — a website with no match can be read (signed-in only, explicit
  // POST) to prefill the existing create form. This is the ONE Build action
  // in the journey. Guests sign in first and come back here with the build
  // intent marker (brandBuildSignInHref), and the same form then submits
  // itself once (AutoBuild) — no second press. Adding it manually stays
  // available.
  if (inputKind === "website") {
    return (
      <StateBlock title="Add Your Brand" body="We didn't find this brand on Findmi. Findmi will build a starting profile from your website, and you'll review everything before it's added.">
        {searched}
        {!authenticated && <p className="mt-4 text-sm text-ink/60">You&rsquo;ll sign in or create an account to review and add your brand.</p>}
        {authenticated ? (
          <form action={buildBrandProfile} className="mt-5">
            <input type="hidden" name="website" value={value} />
            <SeedFields seed={seed} />
            <BuildProfileButton />
            {resumeBuild && <AutoBuild guardKey={[value, seed.name ?? "", seed.instagram ?? ""].join("|")} param={BRAND_BUILD_RESUME_PARAM} />}
          </form>
        ) : (
          <PrimaryLink href={brandBuildSignInHref(value, seed)} label="Build My Brand Profile" />
        )}
        <SecondaryLink href={addHref} label="Add It Myself" />
        <SecondaryLink href="/join/brand" label="Search Again" subtle />
      </StateBlock>
    );
  }

  // V1.1B correction — a name or Instagram with no match asks for the
  // brand's website (never searched for automatically). It goes through
  // the ordinary website lookup first (an existing Business → Claim), then
  // the website no-match state above. The original search rides along as
  // a bounded seed. Adding it manually stays available.
  const instagramSeed = inputKind === "instagram" ? sanitizeBrandSeed({ instagram: value }).instagram : undefined;
  return (
    <WebsitePrompt
      title={`We Couldn't Find ${instagramSeed ? `@${instagramSeed}` : value}`}
      body="Add your website and Findmi will build the starting profile for you."
      seed={inputKind === "name" ? { name: value } : { instagram: instagramSeed }}
      addHref={addHref}
    >
      {searched}
    </WebsitePrompt>
  );
}

function SeedFields({ seed }: { seed: BrandSeed }) {
  return (
    <>
      {brandSeedEntries(seed).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
    </>
  );
}

/** The website step for a name/Instagram search: a GET back into the
 * ordinary website lookup (as=website), carrying the bounded seed. */
function WebsitePrompt({
  title,
  body,
  seed,
  addHref,
  value = "",
  children,
}: {
  title: string;
  body: string;
  seed: BrandSeed;
  addHref: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <StateBlock title={title} body={body}>
      {children}
      <form method="get" action="/join/brand" className="mt-5 flex flex-col gap-3">
        <input type="hidden" name="as" value="website" />
        <SeedFields seed={seed} />
        <label htmlFor="brand-website" className="text-sm font-semibold text-ink">
          Website
        </label>
        <input
          id="brand-website"
          name="q"
          type="text"
          inputMode="url"
          required
          minLength={2}
          maxLength={BRAND_QUERY_MAX_LENGTH}
          defaultValue={value}
          autoComplete="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="yourbrand.com"
          className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-input text-primary placeholder:text-subtle focus:border-ink/30 focus:outline-none"
        />
        <button
          type="submit"
          className="flex h-12 w-full items-center justify-center rounded-2xl bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Continue
        </button>
      </form>
      <SecondaryLink href={addHref} label="Add It Myself" />
      <SecondaryLink href="/join/brand" label="Search Again" subtle />
    </StateBlock>
  );
}

function AssistanceBlock({ children }: { children?: React.ReactNode }) {
  return (
    <StateBlock
      title="This Brand May Already Be on Findmi"
      body="It looks like this brand may already have a listing that isn't public yet. Reach out and we'll help you access it or sort it out."
    >
      {children}
      <PrimaryLink href="/join/sales" label="Contact Findmi" />
      <SecondaryLink href="/join/brand" label="Search Again" subtle />
    </StateBlock>
  );
}

function BrandCard({ card, claimUrl }: { card: PublicBrandCard; claimUrl: string }) {
  const meta = [card.category, [card.city, card.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-black/10 bg-white p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-findmi-50">
          {card.logoUrl ? (
            <SupabaseImage src={card.logoUrl} alt="" fill sizes="48px" className="object-contain" />
          ) : (
            <NavIcon name="storefront" className="h-6 w-6 text-findmi-700" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-base font-bold tracking-tight text-ink">{card.name}</span>
          {meta && <span className="block text-xs text-ink/55">{meta}</span>}
        </span>
      </div>
      <Link
        href={claimUrl}
        className="flex h-10 w-full items-center justify-center rounded-full bg-findmi px-4 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
      >
        Claim This Brand
      </Link>
    </div>
  );
}

function SearchForm({ value }: { value: string }) {
  return (
    <form method="get" action="/join/brand" className="mt-5 flex flex-col gap-3">
      <label htmlFor="brand-q" className="sr-only">
        Business name, website or Instagram
      </label>
      <input
        id="brand-q"
        name="q"
        type="text"
        required
        minLength={2}
        maxLength={BRAND_QUERY_MAX_LENGTH}
        defaultValue={value}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder="Business name, website or Instagram"
        className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-input text-primary placeholder:text-subtle focus:border-ink/30 focus:outline-none"
      />
      <button
        type="submit"
        className="flex h-12 w-full items-center justify-center rounded-2xl bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
      >
        Continue
      </button>
    </form>
  );
}

function StateBlock({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <>
      <h1 className="font-display text-page-title font-bold tracking-tight text-ink">{title}</h1>
      <p className="mt-1.5 text-sm text-ink/60">{body}</p>
      {children}
    </>
  );
}

function PrimaryLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="mt-5 flex h-12 w-full items-center justify-center rounded-2xl bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
    >
      {label}
    </Link>
  );
}

function SecondaryLink({ href, label, subtle = false }: { href: string; label: string; subtle?: boolean }) {
  return (
    <Link
      href={href}
      className={`mt-3 flex items-center justify-center gap-1 text-sm font-semibold ${subtle ? "text-ink/45 hover:text-ink/70" : "text-findmi-700 hover:underline"}`}
    >
      {label}
      {!subtle && <ChevronIcon direction="right" className="h-3 w-3" />}
    </Link>
  );
}

function AltLink({ href, label }: { href: string; label: string }) {
  return <SecondaryLink href={href} label={label} />;
}
